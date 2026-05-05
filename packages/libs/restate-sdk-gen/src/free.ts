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
import type { State, SharedState, TypedState, UntypedState } from "./state.js";
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

export const state = <
  TState extends TypedState = UntypedState,
>(): State<TState> => currentOps().state<TState>();

export const sharedState = <
  TState extends TypedState = UntypedState,
>(): SharedState<TState> => currentOps().sharedState<TState>();

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
