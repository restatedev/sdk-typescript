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

import type {
  APIGatewayProxyEvent,
  APIGatewayProxyEventV2,
  APIGatewayProxyResult,
  APIGatewayProxyStructuredResultV2,
  Context,
} from "aws-lambda";
import { Buffer } from "node:buffer";
import type { GenericHandler, RestateRequest } from "./generic.js";
import { WritableStream, type ReadableStream } from "node:stream/web";
import { OnceStream } from "../../utils/streams.js";
import { X_RESTATE_SERVER } from "../../user_agent.js";
import { ensureError } from "../../types/errors.js";

export class LambdaHandler {
  constructor(private readonly handler: GenericHandler) {}

  async handleRequest(
    event: APIGatewayProxyEvent | APIGatewayProxyEventV2,
    context: Context
  ): Promise<APIGatewayProxyResult | APIGatewayProxyStructuredResultV2> {
    //
    // Request path
    //
    const path = "path" in event ? event.path : event.rawPath;

    //
    // Convert the request body to a Uint8Array stream
    // Lambda functions receive the body as base64 encoded string
    //
    let body: ReadableStream<Uint8Array> | null;
    if (!event.body) {
      body = null;
    } else if (event.isBase64Encoded) {
      body = OnceStream(Buffer.from(event.body, "base64"));
    } else {
      body = OnceStream(new TextEncoder().encode(event.body));
    }

    const request: RestateRequest = {
      body,
      headers: event.headers,
      url: path,
      extraArgs: [context],
    };

    const resp = await this.handler.handle(request, {
      AWSRequestId: context.awsRequestId,
    });

    const chunks: Uint8Array[] = [];

    try {
      await resp.body.pipeTo(
        new WritableStream<Uint8Array>({
          write: (chunk) => {
            chunks.push(chunk);
          },
        })
      );
    } catch (e) {
      // unlike in the streaming case, we can actually catch errors in the response body and form a nicer error
      const error = ensureError(e);
      this.handler.endpoint.rlog.error(
        "Error while collecting invocation response: " +
          (error.stack ?? error.message)
      );
      return {
        headers: {
          "content-type": "application/json",
          "x-restate-server": X_RESTATE_SERVER,
        },
        statusCode: 500,
        isBase64Encoded: false,
        body: JSON.stringify({ message: error.message }),
      };
    }

    return {
      headers: resp.headers,
      statusCode: resp.statusCode,
      isBase64Encoded: true,
      body: Buffer.concat(chunks).toString("base64"),
    };
  }
}
