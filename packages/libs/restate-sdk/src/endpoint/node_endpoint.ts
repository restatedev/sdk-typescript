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

import type { RestateEndpoint } from "../index.js";
import type {
  JournalValueCodec,
  ServiceDefinition,
  VirtualObjectDefinition,
  WorkflowDefinition,
} from "@restatedev/restate-sdk-core";
import { Http2ServerRequest, Http2ServerResponse } from "http2";
import * as http2 from "http2";
import type { Endpoint } from "./endpoint.js";
import { EndpointBuilder } from "./endpoint.js";
import {
  GenericHandler,
  tryCreateContextualLogger,
} from "./handlers/generic.js";
import { Readable, Writable } from "node:stream";
import { WritableStream } from "node:stream/web";
import { ensureError } from "../types/errors.js";
import type { LoggerTransport } from "../logging/logger_transport.js";
import type { DefaultServiceOptions } from "../endpoint.js";

export class NodeEndpoint implements RestateEndpoint {
  private builder: EndpointBuilder = new EndpointBuilder();

  public bind<P extends string, M>(
    definition:
      | ServiceDefinition<P, M>
      | VirtualObjectDefinition<P, M>
      | WorkflowDefinition<P, M>
  ): RestateEndpoint {
    this.builder.bind(definition);
    return this;
  }

  public withIdentityV1(...keys: string[]): RestateEndpoint {
    this.builder.addIdentityKeys(...keys);
    return this;
  }

  public defaultServiceOptions(
    options: DefaultServiceOptions
  ): RestateEndpoint {
    this.builder.setDefaultServiceOptions(options);
    return this;
  }

  public setLogger(logger: LoggerTransport): RestateEndpoint {
    this.builder.setLogger(logger);
    return this;
  }

  public journalValueCodecProvider(
    codecProvider: () => Promise<JournalValueCodec>
  ): RestateEndpoint {
    this.builder.setJournalValueCodecProvider(codecProvider);
    return this;
  }

  http2Handler(): (
    request: Http2ServerRequest,
    response: Http2ServerResponse
  ) => void {
    return nodeHttp2Handler(this.builder.build());
  }

  listen(port?: number): Promise<number> {
    const endpoint = this.builder.build();

    const actualPort = port ?? parseInt(process.env.PORT ?? "9080");
    endpoint.rlog.info(`Restate SDK started listening on ${actualPort}...`);

    const server = http2.createServer(nodeHttp2Handler(endpoint));

    return new Promise((resolve, reject) => {
      let failed = false;
      server.once("error", (e: Error) => {
        failed = true;
        reject(e);
      });
      server.listen(actualPort, () => {
        if (failed) {
          return;
        }
        const address = server.address();
        if (address === null || typeof address === "string") {
          reject(
            new TypeError(
              "endpoint.listen() currently supports only binding to a PORT"
            )
          );
        } else {
          resolve(address.port);
        }
      });
    });
  }
}

function nodeHttp2Handler(
  endpoint: Endpoint
): (request: Http2ServerRequest, response: Http2ServerResponse) => void {
  const handler = new GenericHandler(endpoint, "BIDI_STREAM", {});

  return (httpRequest, httpResponse) => {
    const url = httpRequest.url;

    // Abort controller used to cleanup resources at the end of this stream lifecycle
    const abortController = new AbortController();
    httpRequest.on("close", () => {
      // The 'close' event is emitted when the Http2Stream is destroyed.
      abortController.abort();
    });

    // Prepare streams to pass to generic handler
    const webInputStream = Readable.toWeb(httpRequest);
    const webOutputStream = Writable.toWeb(
      httpResponse
    ) as unknown as WritableStream<Uint8Array>;

    const restateResponse = handler.handle({
      url,
      headers: httpRequest.headers,
      extraArgs: [],
    });

    httpResponse.writeHead(restateResponse.statusCode, restateResponse.headers);

    restateResponse
      .process({
        inputStream: webInputStream,
        outputStream: webOutputStream,
        abortSignal: abortController.signal,
      })
      .catch((e) => {
        // handle should never throw
        const error = ensureError(e);
        const logger =
          tryCreateContextualLogger(
            endpoint.loggerTransport,
            url,
            httpRequest.headers
          ) ?? endpoint.rlog;
        logger.error("Unexpected error: " + (error.stack ?? error.message));
      });
  };
}
