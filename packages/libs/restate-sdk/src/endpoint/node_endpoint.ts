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

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Http2ServerRequest, Http2ServerResponse } from "node:http2";
import * as http2 from "node:http2";
import type { Endpoint } from "./endpoint.js";
import { EndpointBuilder } from "./endpoint.js";
import {
  GenericHandler,
  tryCreateContextualLogger,
} from "./handlers/generic.js";
import { Readable, Writable } from "node:stream";
import type { ReadableStream, WritableStream } from "node:stream/web";
import { ensureError } from "../types/errors.js";
import type { LoggerTransport } from "../logging/logger_transport.js";
import type { DefaultServiceOptions } from "../endpoint.js";
import type { ProtocolMode } from "./discovery.js";

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

  http2Handler(options?: {
    bidirectional?: boolean;
  }): (request: Http2ServerRequest, response: Http2ServerResponse) => void {
    return nodeHttp2Handler(
      this.builder.build(),
      options?.bidirectional === false ? "REQUEST_RESPONSE" : "BIDI_STREAM"
    );
  }

  http1Handler(options?: {
    bidirectional?: boolean;
  }): (request: IncomingMessage, response: ServerResponse) => void {
    return nodeHttp1Handler(
      this.builder.build(),
      options?.bidirectional ? "BIDI_STREAM" : "REQUEST_RESPONSE"
    );
  }

  handler(options?: { bidirectional?: boolean }): {
    (request: IncomingMessage, response: ServerResponse): void;
    (request: Http2ServerRequest, response: Http2ServerResponse): void;
  } {
    const endpoint = this.builder.build();
    const h2Handler = nodeHttp2Handler(
      endpoint,
      options?.bidirectional === false ? "REQUEST_RESPONSE" : "BIDI_STREAM"
    );
    const h1Handler = nodeHttp1Handler(
      endpoint,
      options?.bidirectional ? "BIDI_STREAM" : "REQUEST_RESPONSE"
    );

    return ((
      request: IncomingMessage | Http2ServerRequest,
      response: ServerResponse | Http2ServerResponse
    ) => {
      if (request.httpVersionMajor >= 2) {
        h2Handler(
          request as Http2ServerRequest,
          response as Http2ServerResponse
        );
      } else {
        h1Handler(request as IncomingMessage, response as ServerResponse);
      }
    }) as {
      (request: IncomingMessage, response: ServerResponse): void;
      (request: Http2ServerRequest, response: Http2ServerResponse): void;
    };
  }

  listen(port?: number): Promise<number> {
    const endpoint = this.builder.build();

    const actualPort = port ?? parseInt(process.env.PORT ?? "9080");
    endpoint.rlog.info(`Restate SDK started listening on ${actualPort}...`);

    const server = http2.createServer(
      nodeHttp2Handler(endpoint, "BIDI_STREAM")
    );

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

function nodeHttp1Handler(
  endpoint: Endpoint,
  protocolMode: ProtocolMode
): (request: IncomingMessage, response: ServerResponse) => void {
  return nodeHandlerImpl(endpoint, protocolMode);
}

function nodeHttp2Handler(
  endpoint: Endpoint,
  protocolMode: ProtocolMode
): (request: Http2ServerRequest, response: Http2ServerResponse) => void {
  return nodeHandlerImpl(endpoint, protocolMode);
}

function nodeHandlerImpl(
  endpoint: Endpoint,
  protocolMode: ProtocolMode
): (
  request: Http2ServerRequest | IncomingMessage,
  response: Http2ServerResponse | ServerResponse
) => void {
  const handler = new GenericHandler(endpoint, protocolMode, {});

  return (request, response) => {
    (async () => {
      const abortController = new AbortController();

      request.once("aborted", () => {
        abortController.abort();
      });
      request.once("close", () => {
        abortController.abort();
      });
      request.once("error", () => {
        abortController.abort();
      });

      if (request.destroyed || ("aborted" in request && request.aborted)) {
        endpoint.rlog.error("Client disconnected");
        abortController.abort();
      }

      try {
        // request.url is always defined for incoming HTTP requests;
        // it is only typed as string | undefined on IncomingMessage
        // because the property is technically writable.
        const url = request.url!;
        const webRequestBody = Readable.toWeb(
          request as Readable
        ) as ReadableStream<Uint8Array>;

        const resp = await handler.handle({
          url,
          headers: request.headers,
          body: webRequestBody,
          extraArgs: [],
          abortSignal: abortController.signal,
        });

        if (response.destroyed) {
          return;
        }

        (response as ServerResponse).writeHead(resp.statusCode, resp.headers);
        const responseWeb = Writable.toWeb(
          response
        ) as WritableStream<Uint8Array>;
        await resp.body.pipeTo(responseWeb);
      } catch (e) {
        const error = ensureError(e);

        const logger =
          tryCreateContextualLogger(
            endpoint.loggerTransport,
            String(request.url),
            request.headers
          ) ?? endpoint.rlog;
        if (error.name === "AbortError") {
          logger.error(
            "Got abort error from connection: " +
              error.message +
              "\n" +
              "This might indicate that:\n" +
              "* The restate-server aborted the connection after hitting the 'abort-timeout'\n" +
              "* The connection with the restate-server was lost\n" +
              "\n" +
              "Please check the invocation in the Restate UI for more details."
          );
        } else {
          logger.error(
            "Error while handling request: " + (error.stack ?? error.message)
          );
        }

        response.destroy(error);
        abortController.abort();
      }
    })().catch(() => {});
  };
}
