/*
 * Copyright (c) 2023-2024 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

import { rlog } from "../logger";
import {
  APIGatewayProxyEvent,
  APIGatewayProxyEventV2,
  APIGatewayProxyResult,
  APIGatewayProxyResultV2,
  Context,
} from "aws-lambda";
import { EndpointImpl } from "./endpoint_impl";
import { LambdaConnection } from "../connection/lambda_connection";
import { InvocationBuilder } from "../invocation";
import { decodeLambdaBody } from "../io/decoder";
import { Message } from "../types/types";
import { StateMachine } from "../state_machine";
import { ensureError } from "../types/errors";
import { OUTPUT_ENTRY_MESSAGE_TYPE } from "../types/protocol";
import { ProtocolMode } from "../types/discovery";
import {
  ComponentHandler,
  UrlPathComponents,
  VirtualObjectHandler,
  parseUrlComponents,
} from "../types/components";
import { validateRequestSignature } from "./request_signing/validate";

export class LambdaHandler {
  constructor(private readonly endpoint: EndpointImpl) {}

  // --------------------------------------------------------------------------

  /**
   * This is the main request handling method, effectively a typed variant of `create()`.
   */
  async handleRequest(
    event: APIGatewayProxyEvent | APIGatewayProxyEventV2,
    context: Context
  ): Promise<APIGatewayProxyResult | APIGatewayProxyResultV2> {
    const path = "path" in event ? event.path : event.rawPath;
    const httpMethod =
      "httpMethod" in event
        ? event.httpMethod
        : event.requestContext.http.method;

    const error = this.validateConnectionSignature(
      path,
      httpMethod,
      event.headers
    );
    if (error !== null) {
      return error;
    }

    const parsed = parseUrlComponents(path);
    if (!parsed) {
      const msg = `Invalid path: path doesn't end in /invoke/SvcName/MethodName and also not in /discover: ${path}`;
      rlog.trace(msg);
      return this.toErrorResponse(404, msg);
    }
    if (parsed === "discovery") {
      return this.handleDiscovery();
    }
    const parsedUrl = parsed as UrlPathComponents;
    const method = this.endpoint.componentByName(parsedUrl.componentName);
    if (!method) {
      const msg = `No service found for URL: ${parsedUrl}`;
      rlog.error(msg);
      return this.toErrorResponse(404, msg);
    }
    const handler = method?.handlerMatching(parsedUrl);
    if (!handler) {
      const msg = `No service found for URL: ${parsedUrl}`;
      rlog.error(msg);
      return this.toErrorResponse(404, msg);
    }
    if (!event.body) {
      throw new Error("The incoming message body was null");
    }
    return this.handleInvoke(handler, event.body, context);
  }

  private validateConnectionSignature(
    path: string,
    method: string,
    headers: { [name: string]: string | string[] | undefined }
  ): APIGatewayProxyResult | APIGatewayProxyResultV2 | null {
    if (!this.endpoint.keySet) {
      // not validating
      return null;
    }

    try {
      const validateResponse = validateRequestSignature(
        this.endpoint.keySet,
        method,
        path,
        headers
      );

      if (!validateResponse.valid) {
        rlog.error(
          `Rejecting request with public keys ${validateResponse.invalidKeys} as its signature did not validate`
        );
        return this.toErrorResponse(401, "Unauthorized");
      } else {
        return null;
      }
    } catch (e) {
      const error = ensureError(e);
      rlog.error(
        "Error while attempting to validate request signature:" + error.stack ??
          error.message
      );
      return this.toErrorResponse(401, "Unauthorized");
    }
  }

  private async handleInvoke(
    handler: ComponentHandler,
    body: string,
    context: Context
  ): Promise<APIGatewayProxyResult | APIGatewayProxyResultV2> {
    try {
      // build the previous journal from the events
      let decodedEntries: Message[] | null = decodeLambdaBody(body);
      const journalBuilder = new InvocationBuilder(handler);
      decodedEntries.forEach((e: Message) => journalBuilder.handleMessage(e));
      const alreadyCompleted =
        decodedEntries.find(
          (e: Message) => e.messageType === OUTPUT_ENTRY_MESSAGE_TYPE
        ) !== undefined;
      decodedEntries = null;

      // set up and invoke the state machine
      const connection = new LambdaConnection(alreadyCompleted);
      const invocation = journalBuilder.build();
      const stateMachine = new StateMachine(
        connection,
        invocation,
        ProtocolMode.REQUEST_RESPONSE,
        handler instanceof VirtualObjectHandler,
        invocation.inferLoggerContext({
          AWSRequestId: context.awsRequestId,
        })
      );
      await stateMachine.invoke();
      const result = await connection.getResult();

      return {
        headers: {
          "content-type": "application/restate",
        },
        statusCode: 200,
        isBase64Encoded: true,
        body: encodeResponse(result),
      };
    } catch (e) {
      const error = ensureError(e);
      rlog.error(error.message);
      rlog.error(error.stack);
      return this.toErrorResponse(500, error.message);
    }
  }

  private handleDiscovery(): APIGatewayProxyResult | APIGatewayProxyResultV2 {
    const disocvery = this.endpoint.computeDiscovery();
    const discoveryJson = JSON.stringify(disocvery);
    const body = Buffer.from(discoveryJson).toString("base64");

    return {
      headers: {
        "content-type": "application/json",
      },
      statusCode: 200,
      isBase64Encoded: true,
      body,
    };
  }

  private toErrorResponse(code: number, message: string) {
    return {
      headers: {
        "content-type": "application/restate",
      },
      statusCode: code,
      isBase64Encoded: true,
      body: encodeResponse(Buffer.from(JSON.stringify({ message }))),
    };
  }
}

function encodeResponse(data: Uint8Array): string {
  const buffer = data instanceof Buffer ? data : Buffer.from(data);
  return buffer.toString("base64");
}
