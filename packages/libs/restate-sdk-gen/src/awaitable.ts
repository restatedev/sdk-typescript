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

// The scheduler interacts with journal-backed work through a tiny abstract
// interface. Production wires this to RestatePromise; tests wire it to a
// hand-controlled promise type.
//
// Surface used internally:
//   - awaitability (Awaitable<T> is a thenable)
//   - .map((v, e) => U): project a settled state into something else; this
//     is the shape Restate exposes (single callback receiving either value
//     or error), and it's what the main loop uses to tag promises with
//     their index before racing them
//   - static all/race over arrays of awaitables
//
// Nothing else from RestatePromise leaks into the scheduler.

import type { FutureSettledResult } from "./future.js";

export interface Awaitable<T> extends PromiseLike<T> {
  /**
   * Project a settled state into a new awaitable.
   * The callback receives `(value, undefined)` on success or
   * `(undefined, error)` on rejection, matching Restate's API.
   */
  map<U>(f: (v: T | undefined, e: unknown) => U): Awaitable<U>;
}

/**
 * Combinator surface. Same shape as `RestatePromise.all/race/any/
 * allSettled` (which themselves mirror the native `Promise.*`).
 *
 * Tuple-aware via `const T extends readonly Awaitable<unknown>[]`:
 * a literal `[Awaitable<A>, Awaitable<B>]` infers `T = readonly
 * [Awaitable<A>, Awaitable<B>]`, and the result projects per slot
 * via `Awaited<T[P]>` instead of widening to a union. So
 * `lib.all([Awaitable<string>, Awaitable<number>])` is
 * `Awaitable<[string, number]>`, not `Awaitable<(string | number)[]>`.
 *
 * `Awaitable<T>` extends `PromiseLike<T>`, so the standard
 * `Awaited<X>` correctly unwraps each tuple slot to its value type.
 */
export interface AwaitableLib {
  all<const T extends readonly Awaitable<unknown>[]>(
    items: T
  ): Awaitable<{ -readonly [P in keyof T]: Awaited<T[P]> }>;
  race<const T extends readonly Awaitable<unknown>[]>(
    items: T
  ): Awaitable<Awaited<T[number]>>;
  any<const T extends readonly Awaitable<unknown>[]>(
    items: T
  ): Awaitable<Awaited<T[number]>>;
  allSettled<const T extends readonly Awaitable<unknown>[]>(
    items: T
  ): Awaitable<{
    -readonly [P in keyof T]: FutureSettledResult<Awaited<T[P]>>;
  }>;
  /**
   * Predicate that classifies a rejection as invocation cancellation
   * versus any other failure. Lives on the lib so the scheduler stays
   * decoupled from `restate.CancelledError`: production wires this to
   * `e instanceof CancelledError`; tests provide their own marker.
   */
  isCancellation(e: unknown): boolean;
}
