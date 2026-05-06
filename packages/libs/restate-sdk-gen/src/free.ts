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
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument */

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
import type { GenDurablePromise } from "./durable-promise.js";
import type {
  RestateOperations,
  RunAction,
  RunOpts,
} from "./restate-operations.js";
import type { Descriptor, HandlerDescriptor } from "./define.js";
import type { GenClient, GenSendClient } from "./clients.js";
import {
  InvocationReferenceImpl,
  type InvocationReference,
} from "./invocation-reference.js";
import { getCurrent } from "./current.js";
import type { HandlerRequest } from "./restate-operations.js";

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
// ---- context accessor ----

/**
 * Returns the current invocation's request metadata plus the optional
 * virtual-object / workflow key. The `key` field is only present when
 * the handler belongs to an object or workflow.
 */
export const handlerRequest = (): HandlerRequest =>
  currentOps().handlerRequest();

// ---- journal-backed Futures ----

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

// ---- unified typed clients ----

export function client<H extends Record<string, HandlerDescriptor>>(
  def: Descriptor<string, H, "service">
): GenClient<H>;
export function client<H extends Record<string, HandlerDescriptor>>(
  def: Descriptor<string, H, "object" | "workflow">,
  key: string
): GenClient<H>;
export function client(
  def: Descriptor<
    string,
    Record<string, HandlerDescriptor>,
    "service" | "object" | "workflow"
  >,
  key?: string
): GenClient<Record<string, HandlerDescriptor>> {
  return currentOps().client(def as Descriptor<string, any, any>, key as any);
}

export function sendClient<H extends Record<string, HandlerDescriptor>>(
  def: Descriptor<string, H, "service">
): GenSendClient<H>;
export function sendClient<H extends Record<string, HandlerDescriptor>>(
  def: Descriptor<string, H, "object" | "workflow">,
  key: string
): GenSendClient<H>;
export function sendClient(
  def: Descriptor<
    string,
    Record<string, HandlerDescriptor>,
    "service" | "object" | "workflow"
  >,
  key?: string
): GenSendClient<Record<string, HandlerDescriptor>> {
  return currentOps().sendClient(
    def as Descriptor<string, any, any>,
    key as any
  );
}

// ---- generic call/send (renamed from genericCall/genericSend) ----

export const call = <REQ = Uint8Array, RES = Uint8Array>(
  c: restate.GenericCall<REQ, RES>
): Future<RES> => currentOps().call<REQ, RES>(c);

export const send = <REQ = Uint8Array>(
  c: restate.GenericSend<REQ>
): Future<InvocationReference<unknown>> => currentOps().send<REQ>(c);

// ---- invocation reference ----

/**
 * Create an InvocationReference from a known invocation ID (e.g. retrieved from state).
 * `attach()` and `cancel()` on the result use the current fiber slot like all free functions.
 */
export function invocation<O = unknown>(
  id: string,
  opts?: { outputSerde?: restate.Serde<O> }
): InvocationReference<O> {
  return new InvocationReferenceImpl<O>(id, opts?.outputSerde);
}

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
): GenDurablePromise<T> => currentOps().workflowPromise<T>(name, serde);

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
