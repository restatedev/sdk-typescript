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

// Production wiring: an AwaitableLib backed by restate.RestatePromise.
//
// RestatePromise is structurally compatible with Awaitable<T> already — it
// has `.map((v, e) => U)` and is thenable. The adapter is a simple cast
// at the boundary; the four combinators forward to RestatePromise's
// static methods, preserving the tuple-aware result types declared on
// AwaitableLib.

import * as restate from "@restatedev/restate-sdk";
import type { Awaitable, AwaitableLib } from "./awaitable.js";
import type { FutureSettledResult } from "./future.js";

export const defaultLib: AwaitableLib = {
  all<const T extends readonly Awaitable<unknown>[]>(
    items: T
  ): Awaitable<{ -readonly [P in keyof T]: Awaited<T[P]> }> {
    return restate.RestatePromise.all(
      items as unknown as readonly restate.RestatePromise<unknown>[]
    ) as unknown as Awaitable<{ -readonly [P in keyof T]: Awaited<T[P]> }>;
  },
  race<const T extends readonly Awaitable<unknown>[]>(
    items: T
  ): Awaitable<Awaited<T[number]>> {
    return restate.RestatePromise.race(
      items as unknown as readonly restate.RestatePromise<unknown>[]
    ) as unknown as Awaitable<Awaited<T[number]>>;
  },
  any<const T extends readonly Awaitable<unknown>[]>(
    items: T
  ): Awaitable<Awaited<T[number]>> {
    return restate.RestatePromise.any(
      items as unknown as readonly restate.RestatePromise<unknown>[]
    ) as unknown as Awaitable<Awaited<T[number]>>;
  },
  allSettled<const T extends readonly Awaitable<unknown>[]>(
    items: T
  ): Awaitable<{
    -readonly [P in keyof T]: FutureSettledResult<Awaited<T[P]>>;
  }> {
    return restate.RestatePromise.allSettled(
      items as unknown as readonly restate.RestatePromise<unknown>[]
    ) as unknown as Awaitable<{
      -readonly [P in keyof T]: FutureSettledResult<Awaited<T[P]>>;
    }>;
  },
  // Invocation cancellation arrives at the aggregate race promise as a
  // CancelledError (the SDK's terminal-error subclass with code 409).
  isCancellation(e: unknown): boolean {
    return e instanceof restate.CancelledError;
  },
};
