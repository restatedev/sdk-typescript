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
import type {
  GenericHandler,
  RestateRequest,
  RestateResponse,
} from "./generic.js";
import { WritableStream, type ReadableStream } from "node:stream/web";
import { OnceStream } from "../../utils/streams.js";
import { X_RESTATE_SERVER } from "../../user_agent.js";
import { ensureError } from "../../types/errors.js";
import * as zlib from "node:zlib";

export class LambdaHandler {
  constructor(private readonly handler: GenericHandler, compression: boolean) {
    // If compression is enabled, let's check we're running a node version that supports it
    if (compression) {
      checkCompressionSupported();
    }
  }

  async handleRequest(
    event: APIGatewayProxyEvent | APIGatewayProxyEventV2,
    context: Context
  ): Promise<APIGatewayProxyResult | APIGatewayProxyStructuredResultV2> {
    //
    // Request path
    //
    const path = "path" in event ? event.path : event.rawPath;

    // Deal with content-encoding
    let requestContentEncoding;
    let requestAcceptEncoding;
    for (const [key, value] of Object.entries(event.headers)) {
      if (
        key.localeCompare("content-encoding", undefined, {
          sensitivity: "accent",
        })
      ) {
        requestContentEncoding = value;
        continue;
      }
      if (
        key.localeCompare("accept-encoding", undefined, {
          sensitivity: "accent",
        })
      ) {
        requestAcceptEncoding = value;
      }
    }

    //
    // Convert the request body to a Uint8Array stream
    // Lambda functions receive the body as base64 encoded string
    //
    let bodyStream: ReadableStream<Uint8Array> | null;
    if (!event.body) {
      bodyStream = null;
    } else {
      let bodyBuffer: Buffer | undefined;
      if (event.isBase64Encoded) {
        bodyBuffer = Buffer.from(event.body, "base64");
      } else {
        bodyBuffer = Buffer.from(new TextEncoder().encode(event.body));
      }

      // Now decode if needed
      if (requestContentEncoding && requestContentEncoding.includes("zstd")) {
        checkCompressionSupported();
        // Input encoded with zstd, let's decode it!
        bodyBuffer = (
          zlib as unknown as { zstdDecompressSync: (b: Buffer) => Buffer }
        ).zstdDecompressSync(bodyBuffer);
      }

      // Prep the stream to pass through the endpoint handler
      bodyStream = OnceStream(bodyBuffer);
    }

    const abortController = new AbortController();

    const request: RestateRequest = {
      body: bodyStream,
      headers: event.headers,
      url: path,
      extraArgs: [context],
      abortSignal: abortController.signal,
    };

    let response: RestateResponse;

    try {
      response = await this.handler.handle(request, {
        AWSRequestId: context.awsRequestId,
      });
    } catch (e) {
      abortController.abort();
      throw e;
    }

    const chunks: Uint8Array[] = [];

    try {
      await response.body.pipeTo(
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
    } finally {
      abortController.abort();
    }

    const responseBodyBuffer = Buffer.concat(chunks);
    let responseBody;

    // Now let's encode if we need to.
    if (requestAcceptEncoding && requestAcceptEncoding.includes("zstd")) {
      checkCompressionSupported();
      response.headers["content-encoding"] = "zstd";

      responseBody = (
        zlib as unknown as { zstdCompressSync: (b: Buffer) => Buffer }
      )
        .zstdCompressSync(responseBodyBuffer)
        .toString("base64");
    } else {
      responseBody = responseBodyBuffer.toString("base64");
    }
    return {
      headers: response.headers,
      statusCode: response.statusCode,
      isBase64Encoded: true,
      body: responseBody,
    };
  }
}

function checkCompressionSupported() {
  if (!("zstdDecompressSync" in zlib) || !("zstdCompressSync" in zlib)) {
    throw new Error(
      "Compression is enabled, but you're running a node version that doesn't support zstd compression. Please use Node.js >= 22."
    );
  }
}
