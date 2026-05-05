// Client wrappers
// =============================================================================
//
// Thin Proxy wrappers around the SDK's typed Clients (`Client<M>`,
// `SendClient<M>`, `DurablePromise<T>`). The SDK returns RestatePromise
// from each handler-invocation method; this module wraps those into
// Future<T> so users can `yield* client.foo(arg)` from a fluent generator
// instead of `await`ing.
//
// Send clients aren't transformed — their methods are synchronous,
// returning `InvocationHandle` immediately, so the SDK shape passes
// through unchanged.

import type * as restate from "@restatedev/restate-sdk";
import type { Future } from "./future.js";

/**
 * Same shape as the SDK's `Client<M>` but each handler returns
 * `Future<O>` instead of `InvocationPromise<O>`. The mapped type
 * preserves the original argument list (including the trailing
 * `opts?: Opts<...>` parameter from the SDK).
 */
export type FluentClient<C> = {
  [K in keyof C]: C[K] extends (
    ...args: infer A
  ) => restate.InvocationPromise<infer R>
    ? (...args: A) => Future<R>
    : C[K];
};

/**
 * Same shape as the SDK's `DurablePromise<T>` but each method returns
 * `Future<...>` instead of `Promise<...>`/`RestatePromise<...>`.
 *
 * Workflow promises are durable; reads are journaled (so `peek`/`get`
 * are journal-backed Futures), and writes (`resolve`/`reject`) record
 * a journal entry that the user yields on.
 */
export type FluentDurablePromise<T> = {
  peek(): Future<T | undefined>;
  resolve(value?: T): Future<void>;
  reject(errorMsg: string): Future<void>;
  get(): Future<T>;
};

/**
 * Wrap an SDK `Client<M>` so each handler-invocation returns
 * `Future<T>` (via the supplied `toFuture` adapter) instead of
 * `InvocationPromise<T>`.
 */
export function wrapClient<C extends object>(
  client: C,
  toFuture: <T>(p: restate.RestatePromise<T>) => Future<T>
): FluentClient<C> {
  return new Proxy(client, {
    get(target, prop, receiver) {
      const orig = Reflect.get(target, prop, receiver) as unknown;
      if (typeof orig !== "function") return orig;
      return (...args: unknown[]) => {
        const rp = (
          orig as (...a: unknown[]) => restate.RestatePromise<unknown>
        ).apply(target, args);
        return toFuture(rp);
      };
    },
  }) as FluentClient<C>;
}

/**
 * Wrap an SDK `DurablePromise<T>` so each method returns `Future<...>`
 * instead of `Promise<...>`/`RestatePromise<...>`.
 */
export function wrapDurablePromise<T>(
  dp: restate.DurablePromise<T>,
  toFuture: <U>(p: restate.RestatePromise<U> | Promise<U>) => Future<U>
): FluentDurablePromise<T> {
  return {
    peek: () =>
      toFuture(dp.peek() as unknown as restate.RestatePromise<T | undefined>),
    resolve: (value?: T) =>
      toFuture(dp.resolve(value) as unknown as restate.RestatePromise<void>),
    reject: (errorMsg: string) =>
      // dp.reject takes a string per Restate's DurablePromise API.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      toFuture(dp.reject(errorMsg) as unknown as restate.RestatePromise<void>),
    get: () => toFuture(dp.get()),
  };
}
