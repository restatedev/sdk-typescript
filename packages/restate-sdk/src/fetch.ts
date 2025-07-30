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

import {
  type FetchEndpoint,
  FetchEndpointImpl,
} from "./endpoint/fetch_endpoint.js";
import type { EndpointOptions } from "./endpoint/types.js";
import { withOptions } from "./endpoint/withOptions.js";

/**
 * Create a new {@link RestateEndpoint} in request response protocol mode.
 * Bidirectional mode (must be served over http2) can be enabled with .enableHttp2()
 */
export function endpoint(): FetchEndpoint {
  return new FetchEndpointImpl("REQUEST_RESPONSE");
}

interface FetchEndpointOptions extends EndpointOptions {
  /**
   * Enables bidirectional communication for the handler.
   *
   * When set to `true`, the handler supports bidirectional streaming (e.g., via HTTP/2 or compatible HTTP/1.1 servers).
   * When `false`, the handler operates in request-response mode only.
   *
   * @default false
   */
  bidirectional?: boolean;
}

/**
 * Creates a Fetch handler that encapsulates all the Restate services served by this endpoint.
 *
 * @param {FetchEndpointOptions} options - Configuration options for the endpoint handler.
 * @returns A fetch handler function.
 *
 * @example
 * A typical request-response handler would look like this:
 * ```
 * import { createEndpointHandler } from "@restatedev/restate-sdk/fetch";
 *
 * export const handler = createEndpointHandler({ services: [myService] })
 *
 * @example
 * A typical bidirectional handler (works with http2 and some http1.1 servers) would look like this:
 * ```
 * import { createEndpointHandler } from "@restatedev/restate-sdk/fetch";
 *
 * export const handler = createEndpointHandler({ services: [myService], bidirectional: true })
 *
 */
export function createEndpointHandler(options: FetchEndpointOptions) {
  return withOptions<FetchEndpoint>(
    new FetchEndpointImpl(
      options.bidirectional ? "BIDI_STREAM" : "REQUEST_RESPONSE"
    ),
    options
  ).handler().fetch;
}
