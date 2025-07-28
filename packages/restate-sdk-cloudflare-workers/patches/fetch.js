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
import { FetchEndpointImpl } from "./endpoint/fetch_endpoint.js";
import { withOptions } from "./endpoint/withOptions.js";
import { cloudflareWorkersBundlerPatch } from "./endpoint/handlers/vm/sdk_shared_core_wasm_bindings.js";
/**
 * Create a new {@link RestateEndpoint} in request response protocol mode.
 * Bidirectional mode (must be served over http2) can be enabled with .enableHttp2()
 * @deprecated Please use {@link createEndpointHandler}
 */
export function endpoint() {
  cloudflareWorkersBundlerPatch();
  return new FetchEndpointImpl("REQUEST_RESPONSE");
}

/**
 * Creates a Cloudflare worker handler that encapsulates all the Restate services served by this endpoint.
 *
 * @param options - Configuration options for the endpoint handler.
 * @returns A worker handler.
 *
 * @example
 * A typical request-response handler would look like this:
 * ```
 * import { createEndpointHandler } from "@restatedev/restate-sdk/restate-sdk-cloudflare-workers";
 *
 * export const handler = createEndpointHandler({ services: [myService] })
 *
 * @example
 * A typical bidirectional handler (works with http2 and some http1.1 servers) would look like this:
 * ```
 * import { createEndpointHandler } from "@restatedev/restate-sdk/restate-sdk-cloudflare-workers";
 *
 * export const handler = createEndpointHandler({ services: [myService], bidirectional: true })
 *
 */
export function createEndpointHandler(options) {
  return withOptions(
    new FetchEndpointImpl(
      options.bidirectional ? "BIDI_STREAM" : "REQUEST_RESPONSE"
    ),
    options
  ).handler().fetch;
}

//# sourceMappingURL=fetch.js.map
