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

export * from "./common_api.js";
import type { RestateEndpoint } from "./endpoint.js";
import { NodeEndpoint } from "./endpoint/node_endpoint.js";
import type { EndpointOptions } from "./endpoint/types.js";
import { withOptions } from "./endpoint/withOptions.js";

/**
 * Create a new {@link RestateEndpoint}.
 * @deprecated Please use {@link createEndpointHandler}
 */
export function endpoint(): RestateEndpoint {
  return new NodeEndpoint();
}

/**
 * Options for creating a Node.js endpoint handler.
 *
 * Extends {@link EndpointOptions} with Node.js-specific options for controlling
 * the protocol mode.
 */
export interface NodeEndpointOptions extends EndpointOptions {
  /**
   * Controls the protocol mode used by the handler.
   *
   * - `undefined` (default): auto-detect based on HTTP version.
   *   HTTP/2+ uses bidirectional streaming (`BIDI_STREAM`),
   *   HTTP/1.1 uses request-response mode (`REQUEST_RESPONSE`).
   * - `true`: force `BIDI_STREAM` for all requests.
   * - `false`: force `REQUEST_RESPONSE` for all requests.
   */
  bidirectional?: boolean;
}

/**
 * Creates a request handler for the provided services.
 *
 * The returned handler auto-detects the HTTP protocol version per request:
 * - HTTP/2+ requests use bidirectional streaming (`BIDI_STREAM`)
 * - HTTP/1.1 requests use request-response mode (`REQUEST_RESPONSE`) by default
 *
 * Set `bidirectional: true` to force `BIDI_STREAM` for all requests, or
 * `bidirectional: false` to force `REQUEST_RESPONSE` for all requests.
 *
 * @example HTTP/2 server
 * ```
 * const httpServer = http2.createServer(createEndpointHandler({ services: [myService] }));
 * httpServer.listen(port);
 * ```
 *
 * @example HTTP/1.1 server
 * ```
 * const httpServer = http.createServer(createEndpointHandler({ services: [myService] }));
 * httpServer.listen(port);
 * ```
 *
 * @param {NodeEndpointOptions} options - Configuration options for the endpoint handler.
 * @returns A request handler function compatible with both HTTP/1.1 and HTTP/2 servers.
 */
export function createEndpointHandler(options: NodeEndpointOptions) {
  const { bidirectional, ...endpointOptions } = options;
  return withOptions<RestateEndpoint>(
    new NodeEndpoint(),
    endpointOptions
  ).handler({ bidirectional });
}

export interface ServeOptions extends EndpointOptions {
  port?: number;
}

/**
 * Serves this Restate services as HTTP2 server, listening to the given port.
 *
 * If the port is undefined, this method will use the port set in the `PORT`
 * environment variable. If that variable is undefined as well, the method will
 * default to port 9080.
 *
 * The returned promise resolves with the bound port when the server starts listening, or rejects with a failure otherwise.
 *
 * If you need to manually control the server lifecycle, we suggest to manually instantiate the http2 server and use {@link createEndpointHandler}.
 *
 * @param {ServeOptions} options - Configuration options for the endpoint handler.
 * @returns a Promise that resolves with the bound port, or rejects with a failure otherwise.
 */
export function serve({ port, ...options }: ServeOptions) {
  return withOptions<RestateEndpoint>(new NodeEndpoint(), options).listen(port);
}
