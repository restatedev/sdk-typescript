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
 * Creates an HTTP/2 request handler for the provided services.
 *
 * @param {EndpointOptions} options - Configuration options for the endpoint handler.
 * @returns An HTTP/2 request handler function.
 */
export function createEndpointHandler(options: EndpointOptions) {
  return withOptions<RestateEndpoint>(
    new NodeEndpoint(),
    options
  ).http2Handler();
}
