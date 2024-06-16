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

import { LambdaEndpoint } from "./endpoint/lambda_endpoint";

// workaround for llrt https://github.com/awslabs/llrt/issues/421
// subarray should copy
Buffer.prototype._subarray = Buffer.prototype.subarray;
Buffer.prototype.subarray = function (start?: number, end?: number) {
  return new Buffer(this._subarray(start, end) as Buffer);
};

/**
 * Create a new {@link LambdaEndpoint}.
 */
export function endpoint(): LambdaEndpoint {
  return new LambdaEndpoint();
}
