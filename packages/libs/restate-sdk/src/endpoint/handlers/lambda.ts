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
import { X_RESTATE_SERVER } from "../../user_agent.js";
import { ensureError } from "../../types/errors.js";
import * as zlib from "node:zlib";
import { InputReader, OutputWriter, RestateHandler } from "./types.js";
import { emptyInputReader, tryCreateContextualLogger } from "./utils.js";

const RESPONSE_COMPRESSION_THRESHOLD = 3 * 1024 * 1024;

export class LambdaHandler {
  constructor(
    private readonly handler: RestateHandler,
    private readonly compressionSupported: boolean
  ) {}

  async handleRequest(
    event: APIGatewayProxyEvent | APIGatewayProxyEventV2,
    context: Context
  ): Promise<APIGatewayProxyResult | APIGatewayProxyStructuredResultV2> {
    const abortController = new AbortController();
    try {
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
          }) === 0
        ) {
          requestContentEncoding = value;
        } else if (
          key.localeCompare("accept-encoding", undefined, {
            sensitivity: "accent",
          }) === 0
        ) {
          requestAcceptEncoding = value;
        }
      }

      //
      // Convert the request body to a Uint8Array stream
      // Lambda functions receive the body as base64 encoded string
      //
      let inputReader: InputReader;
      if (!event.body) {
        inputReader = emptyInputReader();
      } else {
        let bodyBuffer: Buffer | undefined;
        if (event.isBase64Encoded) {
          bodyBuffer = Buffer.from(event.body, "base64");
        } else {
          bodyBuffer = Buffer.from(new TextEncoder().encode(event.body));
        }

        // Now decode if needed
        if (requestContentEncoding && requestContentEncoding.includes("zstd")) {
          if (!this.compressionSupported) {
            throw new Error(
              "The input is compressed using zstd, but this lambda deployment doesn't support compression. Make sure to deploy the Lambda using Node > 22"
            );
          }

          // Input encoded with zstd, let's decode it!
          bodyBuffer = (
            zlib as unknown as { zstdDecompressSync: (b: Buffer) => Buffer }
          ).zstdDecompressSync(bodyBuffer);
        }

        // Prep the stream to pass through the endpoint handler
        // eslint-disable-next-line @typescript-eslint/require-await
        inputReader = (async function* () {
          yield bodyBuffer as Uint8Array;
        })()[Symbol.asyncIterator]();
      }

      const chunks: Uint8Array[] = [];
      const outputWriter: OutputWriter = {
        write: function (value: Uint8Array): Promise<void> {
          chunks.push(value);
          return Promise.resolve();
        },
        close: function (): Promise<void> {
          return Promise.resolve();
        },
      };

      const response = this.handler.handle(
        {
          headers: event.headers,
          url: path,
          extraArgs: [context],
        },
        {
          AWSRequestId: context.awsRequestId,
        }
      );

      try {
        await response.process({
          inputReader,
          outputWriter,
          abortSignal: abortController.signal,
        });
      } catch (e) {
        // handle should never throw
        const error = ensureError(e);
        const logger =
          tryCreateContextualLogger(
            this.handler.endpoint.loggerTransport,
            path,
            event.headers
          ) ?? this.handler.endpoint.rlog;
        logger.error("Unexpected error: " + (error.stack ?? error.message));
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

      const responseBodyBuffer = Buffer.concat(chunks);
      let responseBody;

      // Now let's encode if we need to.
      if (
        this.compressionSupported &&
        responseBodyBuffer.length > RESPONSE_COMPRESSION_THRESHOLD &&
        requestAcceptEncoding &&
        requestAcceptEncoding.includes("zstd")
      ) {
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
    } finally {
      abortController.abort();
    }
  }
}

export function isCompressionSupported() {
  return "zstdDecompressSync" in zlib && "zstdCompressSync" in zlib;
}
