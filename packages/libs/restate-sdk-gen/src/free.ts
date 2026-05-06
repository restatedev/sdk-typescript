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

// Free-standing API
// =============================================================================
//
// Module-level functions that mirror `RestateOperations` methods but
// read the active operations from the synchronous current-fiber slot
// (`current.ts`). User code inside a `gen(function*() { ... })` body
// can call these directly — no `ops` parameter needed.
//
// Each function is a one-liner that resolves the slot via `currentOps()`
// and delegates to the underlying `RestateOperations` method, so this
// file stays in lockstep with the class without duplicating logic.
//
// Usage:
//
//   import { gen, execute, sleep, run, all } from "@restatedev/restate-sdk-gen";
//
//   const myWorkflow = gen(function*() {
//     const a = run(() => fetchA(), { name: "a" });
//     const b = run(() => fetchB(), { name: "b" });
//     const [av, bv] = yield* all([a, b]);
//     yield* sleep(100);
//     return av + bv;
//   });
//
//   // Handler:
//   execute(ctx, myWorkflow);
//
// `select` and `spawn` are already free functions in `operation.ts`
// and require no slot — they yield markers the scheduler dispatches.
// They are re-exported from `index.ts`.

import type * as restate from "@restatedev/restate-sdk";
import type { Future, FutureValues, FutureSettledResult } from "./future.js";
import type { Channel } from "./channel.js";
import type {
  AnyKeySpec,
  StateAccessors,
  UntypedStateAccessors,
} from "./state.js";
import type { FluentClient, FluentDurablePromise } from "./clients.js";
import type {
  RestateOperations,
  RunAction,
  RunOpts,
} from "./restate-operations.js";
import { getCurrent } from "./current.js";

/**
 * Read the active `RestateOperations` from the current-fiber slot.
 * Throws if called outside a fiber's synchronous advance span (e.g.,
 * at module init or inside an `ops.run` async closure that resolved
 * after the fiber returned).
 */
export function currentOps(): RestateOperations {
  return getCurrent() as RestateOperations;
}

// ---- journal-backed Futures ----

/**
 * Run a side-effecting closure as a journal entry. See
 * `RestateOperations.run` for full semantics.
 *
 * `name` is derived from `action.name` (works for named functions and
 * arrow functions assigned to a `const`) or specified explicitly via
 * `opts.name`. If neither resolves, throws.
 */
export const run = <T>(action: RunAction<T>, opts?: RunOpts<T>): Future<T> =>
  currentOps().run(action, opts);

export const sleep = (
  duration: restate.Duration | number,
  name?: string
): Future<void> => currentOps().sleep(duration, name);

export const awakeable = <T>(
  serde?: restate.Serde<T>
): { id: string; promise: Future<T> } => currentOps().awakeable(serde);

export const resolveAwakeable = <T>(
  id: string,
  payload?: T,
  serde?: restate.Serde<T>
): void => currentOps().resolveAwakeable(id, payload, serde);

export const rejectAwakeable = (
  id: string,
  reason: string | restate.TerminalError
): void => currentOps().rejectAwakeable(id, reason);

export const signal = <T>(name: string, serde?: restate.Serde<T>): Future<T> =>
  currentOps().signal(name, serde);

export const attach = <T>(
  invocationId: restate.InvocationId,
  serde?: restate.Serde<T>
): Future<T> => currentOps().attach(invocationId, serde);

// ---- typed clients ----

export const serviceClient = <D>(
  api: restate.ServiceDefinitionFrom<D>
): FluentClient<restate.Client<restate.Service<D>>> =>
  currentOps().serviceClient<D>(api);

export const objectClient = <D>(
  api: restate.VirtualObjectDefinitionFrom<D>,
  key: string
): FluentClient<restate.Client<restate.VirtualObject<D>>> =>
  currentOps().objectClient<D>(api, key);

export const workflowClient = <D>(
  api: restate.WorkflowDefinitionFrom<D>,
  key: string
): FluentClient<restate.Client<restate.Workflow<D>>> =>
  currentOps().workflowClient<D>(api, key);

export const serviceSendClient = <D>(
  api: restate.ServiceDefinitionFrom<D>
): restate.SendClient<restate.Service<D>> =>
  currentOps().serviceSendClient<D>(api);

export const objectSendClient = <D>(
  api: restate.VirtualObjectDefinitionFrom<D>,
  key: string
): restate.SendClient<restate.VirtualObject<D>> =>
  currentOps().objectSendClient<D>(api, key);

export const workflowSendClient = <D>(
  api: restate.WorkflowDefinitionFrom<D>,
  key: string
): restate.SendClient<restate.Workflow<D>> =>
  currentOps().workflowSendClient<D>(api, key);

// ---- generic call/send ----

export const genericCall = <REQ = Uint8Array, RES = Uint8Array>(
  call: restate.GenericCall<REQ, RES>
): Future<RES> => currentOps().genericCall<REQ, RES>(call);

export const genericSend = <REQ = Uint8Array>(
  call: restate.GenericSend<REQ>
): restate.InvocationHandle => currentOps().genericSend<REQ>(call);

// ---- cancel another invocation ----

export const cancel = (invocationId: restate.InvocationId): void =>
  currentOps().cancel(invocationId);

// ---- channels & state ----

export const channel = <T>(): Channel<T> => currentOps().channel<T>();

/**
 * Per-key typed state accessor for virtual objects and workflows.
 * Safe to call at module level — the Restate context is resolved lazily
 * when `.get()`, `.set()`, or `.clear()` is first called inside a handler.
 *
 * @example Keys with defaults return a non-null value; use `typed<T>()` for
 * typed keys without defaults.
 * ```ts
 * const s = state({
 *   count: { default: 0 },          // count.get() → Future<number>
 *   items: { default: () => [] },   // factory default, fresh array each time
 *   label: typed<string>(),         // label.get() → Future<string | null>
 * });
 *
 * // In a handler:
 * const n: number = yield* s.count.get();
 * s.count.set(n + 1);
 * s.count.clear();
 * ```
 *
 * @example Without a config, pass an explicit type — all keys return nullable.
 * ```ts
 * const s = state<{ count: number; label: string }>();
 * const n = (yield* s.count.get()) ?? 0; // Future<number | null>
 * ```
 *
 * When key names are only known at runtime, use instead:
 * `getState`, `setState`, `clearState`, `clearAllState`, `getAllStateKeys`.
 */
export function state<TConfig extends Record<string, AnyKeySpec>>(
  config: TConfig
): StateAccessors<TConfig>;
export function state<
  TShape extends Record<string, unknown>,
>(): UntypedStateAccessors<TShape>;
export function state(
  config?: Record<string, AnyKeySpec>
): UntypedStateAccessors<never> {
  const capturedConfig = config;
  return new Proxy({} as never, {
    get(_target, prop: string) {
      return {
        get: (serde?: unknown) =>
          currentOps()
            .stateKey(prop, capturedConfig?.[prop])
            .get(serde as never),
        set: (value: unknown, serde?: unknown) =>
          currentOps()
            .stateKey(prop, capturedConfig?.[prop])
            .set(value as never, serde as never),
        clear: () =>
          currentOps().stateKey(prop, capturedConfig?.[prop]).clear(),
      };
    },
  });
}

export const getState = <T>(
  name: string,
  serde?: restate.Serde<T>
): Future<T | null> => currentOps().getState<T>(name, serde);

export const setState = <T>(
  name: string,
  value: T,
  serde?: restate.Serde<T>
): void => currentOps().setState(name, value, serde);

export const clearState = (name: string): void => currentOps().clearState(name);

export const clearAllState = (): void => currentOps().clearAllState();

export const getAllStateKeys = (): Future<string[]> =>
  currentOps().getAllStateKeys();

// ---- workflow durable promise ----

export const workflowPromise = <T>(
  name: string,
  serde?: restate.Serde<T>
): FluentDurablePromise<T> => currentOps().workflowPromise<T>(name, serde);

// ---- combinators ----

/**
 * Wait for every future to settle; return their values in input order.
 * Heterogeneous-tuple typing — `all([fA, fB])` where `fA: Future<A>`
 * and `fB: Future<B>` yields `Future<[A, B]>`. Mirrors `Promise.all`.
 */
export const all = <const T extends readonly Future<unknown>[] | []>(
  futures: T
): Future<FutureValues<T>> => currentOps().all(futures);

/**
 * Return the first future to settle; losers continue running but their
 * results are discarded. Heterogeneous-tuple typing — `race([fA, fB])`
 * yields `Future<A | B>`. Mirrors `Promise.race`.
 */
export const race = <const T extends readonly Future<unknown>[] | []>(
  futures: T
): Future<FutureValues<T>[number]> => currentOps().race(futures);

/**
 * First-to-succeed wins (non-rejected). Rejects with `AggregateError(errors)`
 * when every input rejects (including the empty input case). Tuple-aware —
 * `any([fA, fB])` yields `Future<A | B>`. Mirrors `Promise.any`.
 */
export const any = <const T extends readonly Future<unknown>[] | []>(
  futures: T
): Future<FutureValues<T>[number]> => currentOps().any(futures);

/**
 * Wait for every future to settle; never rejects. Tuple-aware —
 * `allSettled([fA, fB])` yields
 * `Future<[FutureSettledResult<A>, FutureSettledResult<B>]>`.
 * Mirrors `Promise.allSettled`.
 */
export const allSettled = <const T extends readonly Future<unknown>[] | []>(
  futures: T
): Future<{
  -readonly [P in keyof T]: FutureSettledResult<
    T[P] extends Future<infer U> ? U : never
  >;
}> => currentOps().allSettled(futures);

// `select` and `spawn` are already free functions in `operation.ts`
// (they yield markers the scheduler dispatches). They are re-exported
// from `index.ts` directly.
