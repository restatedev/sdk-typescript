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

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Http2ServerRequest, Http2ServerResponse } from "node:http2";
import type {
  VirtualObjectDefinition,
  ServiceDefinition,
  WorkflowDefinition,
  JournalValueCodec,
} from "@restatedev/restate-sdk-core";
import type { LoggerTransport } from "./logging/logger_transport.js";
import type {
  ObjectOptions,
  ServiceOptions,
  WorkflowOptions,
} from "./types/rpc.js";

export type DefaultServiceOptions = ServiceOptions &
  ObjectOptions &
  WorkflowOptions;

export interface RestateEndpointBase<E> {
  /**
   * Binds a new durable service / virtual object / workflow.
   *
   * see restate.service, restate.object, and restate.workflow for more details.
   **/
  bind<P extends string, M>(
    service:
      | ServiceDefinition<P, M>
      | VirtualObjectDefinition<P, M>
      | WorkflowDefinition<P, M>
  ): E;

  /**
   * Provide a list of v1 request identity public keys eg `publickeyv1_2G8dCQhArfvGpzPw5Vx2ALciR4xCLHfS5YaT93XjNxX9` to validate
   * incoming requests against, limiting requests to Restate clusters with the corresponding private keys. This public key format is
   * logged by the Restate process at startup if a request identity private key is provided.
   *
   * If this function is called, all incoming requests irrelevant of endpoint type will be expected to have
   * `x-restate-signature-scheme: v1` and `x-restate-jwt-v1: <valid jwt signed with one of these keys>`. If not called,
   *
   */
  withIdentityV1(...keys: string[]): E;

  /**
   * Set default service options that will be used by all services bind to this endpoint.
   *
   * Options can be overridden on each service/handler.
   *
   * @param options
   */
  defaultServiceOptions(options: DefaultServiceOptions): E;

  /**
   * Replace the default console-based {@link LoggerTransport}
   * @param logger
   * @example
   * Using console:
   * ```ts
   * restate.setLogger((meta, message, ...o) => {console.log(`${meta.level}: `, message, ...o)})
   * ```
   * @example
   * Using winston:
   * ```ts
   * const logger = createLogger({ ... })
   * restate.setLogger((meta, message, ...o) => {logger.log(meta.level, {invocationId: meta.context?.invocationId}, [message, ...o].join(' '))})
   * ```
   * @example
   * Using pino:
   * ```ts
   * const logger = pino()
   * restate.setLogger((meta, message, ...o) => {logger[meta.level]({invocationId: meta.context?.invocationId}, [message, ...o].join(' '))})
   * ```
   */
  setLogger(logger: LoggerTransport): E;

  /**
   * Provider for the codec to use for journal values. One codec will be instantiated globally for this endpoint.
   * Check {@link JournalValueCodec} for more details
   *
   * @experimental
   */
  journalValueCodecProvider(codecProvider: () => Promise<JournalValueCodec>): E;
}

/**
 * RestateEndpoint encapsulates all the Restate services served by this endpoint.
 *
 * A RestateEndpoint can be served as:
 * - An HTTP/2 server using {@link RestateEndpoint.listen}, {@link RestateEndpoint.http2Handler}
 * - An HTTP/1.1 server using {@link RestateEndpoint.http1Handler}
 * - A combined HTTP/1.1 + HTTP/2 server using {@link RestateEndpoint.handler}
 *
 * For Lambda, check {@link LambdaEndpoint}
 *
 * @example
 * A typical endpoint served as HTTP/2 server:
 * ```
 * import * as restate from "@restatedev/restate-sdk";
 *
 * restate
 *   .endpoint()
 *   .bind(myService)
 *   .listen(8000);
 * ```
 *
 * @example
 * Using the HTTP/1.1 handler with your own server:
 * ```
 * import * as http from "node:http";
 * import * as restate from "@restatedev/restate-sdk";
 *
 * const endpoint = restate.endpoint().bind(myService);
 * const server = http.createServer(endpoint.http1Handler());
 * server.listen(8000);
 * ```
 *
 * @example
 * Using the combined handler with an HTTP/2 server that also accepts HTTP/1.1:
 * ```
 * import * as http2 from "node:http2";
 * import * as restate from "@restatedev/restate-sdk";
 *
 * const endpoint = restate.endpoint().bind(myService);
 * const server = http2.createSecureServer({ key, cert, allowHTTP1: true }, endpoint.handler());
 * server.listen(8000);
 * ```
 */
export interface RestateEndpoint extends RestateEndpointBase<RestateEndpoint> {
  /**
   * Serve this Restate Endpoint as HTTP2 server, listening to the given port.
   *
   * If the port is undefined, this method will use the port set in the `PORT`
   * environment variable. If that variable is undefined as well, the method will
   * default to port 9080.
   *
   * The returned promise resolves with the bound port when the server starts listening, or rejects with a failure otherwise.
   *
   * This method is a shorthand for:
   *
   * @example
   * ```
   * const httpServer = http2.createServer(endpoint.http2Handler());
   * httpServer.listen(port);
   * ```
   *
   * If you need to manually control the server lifecycle, we suggest to manually instantiate the http2 server and use {@link RestateEndpoint.http2Handler}.
   *
   * @param port The port to listen at. May be undefined (see above).
   * @returns a Promise that resolves with the bound port, or rejects with a failure otherwise.
   */
  listen(port?: number): Promise<number>;

  /**
   * Returns an http2 server handler.
   *
   * By default, this handler uses bidirectional streaming (`BIDI_STREAM`).
   * Set `bidirectional: false` to use request-response mode (`REQUEST_RESPONSE`).
   *
   * See {@link RestateEndpoint.listen} for more details.
   */
  http2Handler(options?: {
    bidirectional?: boolean;
  }): (request: Http2ServerRequest, response: Http2ServerResponse) => void;

  /**
   * Returns an http1 server handler.
   *
   * By default, this handler operates in request-response protocol mode (`REQUEST_RESPONSE`),
   * which buffers the full request before sending the response. This is the safest mode
   * for HTTP/1.1 and works across all environments and proxies.
   *
   * Set `bidirectional: true` to enable bidirectional streaming (`BIDI_STREAM`) for
   * HTTP/1.1 servers that support it. Note that some proxies and clients may not
   * handle HTTP/1.1 bidirectional streaming correctly.
   *
   * @example
   * ```
   * const httpServer = http.createServer(endpoint.http1Handler());
   * httpServer.listen(port);
   * ```
   */
  http1Handler(options?: {
    bidirectional?: boolean;
  }): (request: IncomingMessage, response: ServerResponse) => void;

  /**
   * Returns a combined request handler that auto-detects HTTP/1 vs HTTP/2
   * requests and dispatches to the appropriate internal handler.
   *
   * By default (when `bidirectional` is omitted), HTTP/2+ requests use
   * bidirectional streaming (`BIDI_STREAM`) and HTTP/1 requests use
   * request-response mode (`REQUEST_RESPONSE`).
   *
   * Set `bidirectional: true` to force `BIDI_STREAM` for all requests,
   * or `bidirectional: false` to force `REQUEST_RESPONSE` for all requests.
   *
   * This is useful with `http2.createSecureServer({ allowHTTP1: true })`, where
   * the same server handles both HTTP/1.1 and HTTP/2 connections.
   *
   * @example
   * ```
   * const server = http2.createSecureServer(
   *   { key, cert, allowHTTP1: true },
   *   endpoint.handler()
   * );
   * server.listen(port);
   * ```
   */
  handler(options?: { bidirectional?: boolean }): {
    (request: IncomingMessage, response: ServerResponse): void;
    (request: Http2ServerRequest, response: Http2ServerResponse): void;
  };
}
