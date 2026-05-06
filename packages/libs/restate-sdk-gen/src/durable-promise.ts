/*
 * Copyright (c) 2023-2026 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

import type * as restate from "@restatedev/restate-sdk";
import type { Future } from "./future.js";

/** Same shape as the SDK's DurablePromise<T> but each method returns Future<...>. */
export type GenDurablePromise<T> = {
  peek(): Future<T | undefined>;
  resolve(value?: T): Future<void>;
  reject(errorMsg: string): Future<void>;
  get(): Future<T>;
};

export function wrapDurablePromise<T>(
  dp: restate.DurablePromise<T>,
  toFuture: <U>(p: restate.RestatePromise<U> | Promise<U>) => Future<U>
): GenDurablePromise<T> {
  return {
    peek: () =>
      toFuture(dp.peek() as unknown as restate.RestatePromise<T | undefined>),
    resolve: (value?: T) =>
      toFuture(dp.resolve(value) as unknown as restate.RestatePromise<void>),
    reject: (errorMsg: string) =>
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      toFuture(dp.reject(errorMsg) as unknown as restate.RestatePromise<void>),
    get: () => toFuture(dp.get()),
  };
}
