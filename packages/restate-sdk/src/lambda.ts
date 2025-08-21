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
  LambdaEndpointImpl,
  type LambdaEndpoint,
} from "./endpoint/lambda_endpoint.js";
import type { EndpointOptions } from "./endpoint/types.js";
import { withOptions } from "./endpoint/withOptions.js";

/**
 * Create a new {@link LambdaEndpoint}.
 */
export function endpoint(): LambdaEndpoint {
  return new LambdaEndpointImpl(false);
}

interface LambdaEndpointOptions extends EndpointOptions {
  /**
   * Enable compression of Lambda requests/responses using zstd.
   *
   * NOTE: This feature is supported only from Restate 1.5 onward.
   *
   * @default false
   */
  enableCompression?: boolean;
}

/**
 * Creates a Lambda handler that encapsulates all the Restate services served by this endpoint.
 *
 * @param {EndpointOptions} options - Configuration options for the endpoint handler.
 * @returns A Lambda handler function.
 *
 * @example
 * A typical endpoint served as Lambda would look like this:
 * ```
 * import { createEndpointHandler } from "@restatedev/restate-sdk/lambda";
 *
 * export const handler = createEndpointHandler({ services: [myService] })
 */
export function createEndpointHandler(options: LambdaEndpointOptions) {
  return withOptions<LambdaEndpoint>(
    new LambdaEndpointImpl(options.enableCompression ?? false),
    options
  ).handler();
}
