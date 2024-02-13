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
} from "aws-lambda";
import {
  ProtocolMode,
  ServiceDiscoveryResponse,
} from "../generated/proto/discovery";
import { EndpointImpl, ServiceEndpoint } from "./endpoint_impl";
import { LambdaConnection } from "../connection/lambda_connection";
import { InvocationBuilder } from "../invocation";
import { decodeLambdaBody } from "../io/decoder";
import { Message } from "../types/types";
import { StateMachine } from "../state_machine";
import { ensureError } from "../types/errors";
import { KeyedRouter, ServiceOpts, UnKeyedRouter } from "../public_api";
import { OUTPUT_STREAM_ENTRY_MESSAGE_TYPE } from "../types/protocol";

/**
 * Creates an Restate entrypoint for services deployed on AWS Lambda and invoked
 * through API Gateway.
 *
 * Register services on this entrypoint via {@link LambdaRestateServer.bindService } and
 * then create the Lambda invocation handler via {@link LambdaRestateServer.handle }.
 *
 * @example
 * A typical AWS Lambda entry point would look like this
 * ```
 * import * as restate from "@restatedev/restate-sdk";
 *
 * export const handler = restate
 *   .createLambdaApiGatewayHandler()
 *   .bindService({
 *      service: "MyService",
 *      instance: new myService.MyServiceImpl(),
 *      descriptor: myService.protoMetadata,
 *    })
 *   .handle();
 * ```
 *
 * @deprecated use {@link RestateEndpoint}
 */
export function createLambdaApiGatewayHandler(): LambdaRestateServer {
  return new LambdaRestateServerImpl(new EndpointImpl());
}

/**
 * Restate entrypoint implementation for services deployed on AWS Lambda.
 * This one decodes the requests, create the log event sequence that
 * drives the durable execution of the service invocations.
 *
 * @deprecated use {@link RestateEndpoint}
 */
export interface LambdaRestateServer extends ServiceEndpoint {
  /**
   * Creates the invocation handler function to be called by AWS Lambda.
   *
   * The returned type of this function is `(event: APIGatewayProxyEvent | APIGatewayProxyEventV2) => Promise<APIGatewayProxyResult | APIGatewayProxyResultV2>`.
   * We use `any` types here to avoid a dependency on the `@types/aws-lambda` dependency for consumers of this API.
   *
   * @example
   * A typical AWS Lambda entry point would use this method the follwing way:
   * ```
   * import * as restate from "@restatedev/restate-sdk";
   *
   * export const handler = restate
   *   .createLambdaApiGatewayHandler()
   *   .bindService({
   *      service: "MyService",
   *      instance: new myService.MyServiceImpl(),
   *      descriptor: myService.protoMetadata,
   *    })
   *   .handle();
   * ```
   *
   * @returns The invocation handler function for to be called by AWS Lambda.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handle(): (event: any) => Promise<any>;

  // overridden to make return type more specific
  // docs are inherited from ServiceEndpoint
  bindService(serviceOpts: ServiceOpts): LambdaRestateServer;

  // overridden to make return type more specific
  // docs are inherited from ServiceEndpoint
  bindRouter<M>(path: string, router: UnKeyedRouter<M>): LambdaRestateServer;

  // overridden to make return type more specific
  // docs are inherited from ServiceEndpoint
  bindKeyedRouter<M>(path: string, router: KeyedRouter<M>): LambdaRestateServer;
}

class LambdaRestateServerImpl implements LambdaRestateServer {
  constructor(readonly endpoint: EndpointImpl) {}

  public bindService(serviceOpts: ServiceOpts): LambdaRestateServer {
    this.endpoint.bindService(serviceOpts);
    return this;
  }

  public bindRouter<M>(
    path: string,
    router: UnKeyedRouter<M>
  ): LambdaRestateServer {
    this.endpoint.bindRouter(path, router);
    return this;
  }

  public bindKeyedRouter<M>(
    path: string,
    router: KeyedRouter<M>
  ): LambdaRestateServer {
    this.endpoint.bindKeyedRouter(path, router);
    return this;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public handle(): (event: any) => Promise<any> {
    const handler = new LambdaHandler(this.endpoint);
    return handler.handleRequest.bind(handler);
  }
}

export class LambdaHandler {
  private readonly discoveryResponse: ServiceDiscoveryResponse;
  constructor(private readonly endpoint: EndpointImpl) {
    this.discoveryResponse = ServiceDiscoveryResponse.fromPartial({
      ...this.endpoint.discovery,
      protocolMode: ProtocolMode.REQUEST_RESPONSE,
    });
  }

  // --------------------------------------------------------------------------

  /**
   * This is the main request handling method, effectively a typed variant of `create()`.
   */
  async handleRequest(
    event: APIGatewayProxyEvent | APIGatewayProxyEventV2
  ): Promise<APIGatewayProxyResult | APIGatewayProxyResultV2> {
    let path;
    if ("path" in event) {
      // V1
      path = event.path;
    } else {
      // V2
      path = event.rawPath;
    }
    const pathSegments = path.split("/");

    // API Gateway can add a prefix to the path based on the name of the Lambda function and deployment stage
    // (e.g. /default)
    // So we only check the ending of the path on correctness.
    // Logic:
    // 1. Check whether there are at least three segments in the path and whether the third-last one is "invoke".
    // If that is the case, treat it as an invocation.
    // 2. See if the last one is "discover", answer with discovery.
    // 3. Else report "invalid path".
    if (
      pathSegments.length >= 3 &&
      pathSegments[pathSegments.length - 3] === "invoke"
    ) {
      const url = "/" + pathSegments.slice(-3).join("/");
      return await this.handleInvoke(url, event);
    } else if (pathSegments[pathSegments.length - 1] === "discover") {
      return this.handleDiscovery();
    } else {
      const msg = `Invalid path: path doesn't end in /invoke/SvcName/MethodName and also not in /discover: ${path}`;
      rlog.trace(msg);
      return this.toErrorResponse(500, msg);
    }
  }

  private async handleInvoke(
    url: string,
    event: APIGatewayProxyEvent | APIGatewayProxyEventV2
  ): Promise<APIGatewayProxyResult | APIGatewayProxyResultV2> {
    try {
      const method = this.endpoint.methodByUrl(url);
      if (event.body == null) {
        throw new Error("The incoming message body was null");
      }

      if (method === undefined) {
        if (url.includes("?")) {
          throw new Error(
            `Invalid path: path URL seems to include query parameters: ${url}`
          );
        } else {
          const msg = `No service found for URL: ${url}`;
          rlog.error(msg);
          return this.toErrorResponse(404, msg);
        }
      }

      // build the previous journal from the events
      let decodedEntries: Message[] | null = decodeLambdaBody(event.body);
      const journalBuilder = new InvocationBuilder(method);
      decodedEntries.forEach((e: Message) => journalBuilder.handleMessage(e));
      const alreadyCompleted =
        decodedEntries.find(
          (e: Message) => e.messageType === OUTPUT_STREAM_ENTRY_MESSAGE_TYPE
        ) !== undefined;
      decodedEntries = null;

      // set up and invoke the state machine
      const connection = new LambdaConnection(alreadyCompleted);
      const invocation = journalBuilder.build();
      const stateMachine = new StateMachine(
        connection,
        invocation,
        ProtocolMode.REQUEST_RESPONSE,
        method.method.keyedContext,
        invocation.inferLoggerContext({
          AWSRequestId: event.requestContext.requestId,
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
    // return discovery information
    rlog.info(
      "Answering discovery request. Announcing services: " +
        JSON.stringify(this.discoveryResponse.services)
    );
    return {
      headers: {
        "content-type": "application/proto",
      },
      statusCode: 200,
      isBase64Encoded: true,
      body: encodeResponse(
        ServiceDiscoveryResponse.encode(this.discoveryResponse).finish()
      ),
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
