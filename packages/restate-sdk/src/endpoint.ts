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

import type { Http2ServerRequest, Http2ServerResponse } from "http2";
import type {
  VirtualObjectDefinition,
  ServiceDefinition,
  WorkflowDefinition,
} from "@restatedev/restate-sdk-core";
import type { LoggerTransport } from "./logging/logger_transport.js";

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
   * Replace the default console-based {@link LoggerTransport}
   * @param logger
   * @example
   * Using console:
   * ```ts
   *     restate.setLogger((meta, message, ...o) => {console.log(`${meta.level}: `, message, ...o)})
   *  ```
   * @example
   * Using winston:
   * ```ts
   *     const logger = createLogger({ ... })
   *     restate.setLogger((meta, message, ...o) => {logger.log(meta.level, {invocationId: meta.context?.invocationId}, [message, ...o].join(' '))})
   *  ```
   * @example
   * Using pino:
   * ```ts
   *     const logger = pino()
   *     restate.setLogger((meta, message, ...o) => {logger[meta.level]({invocationId: meta.context?.invocationId}, [message, ...o].join(' '))})
   *  ```
   */
  setLogger(logger: LoggerTransport): E;
}

/**
 * RestateEndpoint encapsulates all the Restate services served by this endpoint.
 *
 * A RestateEndpoint can either be served either as HTTP2 server, using the methods {@link listen} or {@link http2Handler},
 * or as Lambda, using the method {@link lambdaHandler}.
 *
 * @example
 * A typical endpoint served as HTTP server would look like this:
 * ```
 * import * as restate from "@restatedev/restate-sdk";
 *
 * restate
 *   .endpoint()
 *   .bind(myService)
 *   .listen(8000);
 * ```
 * @example
 * A typical endpoint served as AWS Lambda would look like this:
 * ```
 * import * as restate from "@restatedev/restate-sdk/lambda";
 *
 * export const handler = restate
 *   .endpoint()
 *   .bind(myService)
 *   .handler();
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
   * If you need to manually control the server lifecycle, we suggest to manually instantiate the http2 server and use {@link http2Handler}.
   *
   * @param port The port to listen at. May be undefined (see above).
   * @returns a Promise that resolves with the bound port, or rejects with a failure otherwise.
   */
  listen(port?: number): Promise<number>;

  /**
   * Returns an http2 server handler. See {@link listen} for more details.
   */
  http2Handler(): (
    request: Http2ServerRequest,
    response: Http2ServerResponse
  ) => void;
}
