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

export * from "./common_api";

import {
  CloudflareWorkerEndpointImpl,
  type CloudflareWorkerEndpoint,
} from "./endpoint/cloudflare_endpoint";

/**
 * Create a new {@link RestateEndpoint}.
 */
export function endpoint(): CloudflareWorkerEndpoint {
  return new CloudflareWorkerEndpointImpl();
}
