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
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unnecessary-type-assertion */

// RestateOperations
// =============================================================================
//
// Production-side wrapper around restate.Context. Produces journal-backed
// Futures by delegating to the Restate SDK; defers to the scheduler for
// spawn/all/race/select.
//
// Tests don't need this class — they construct Futures via
// `Scheduler.makeJournalFuture(testPromise)` directly, build operations via
// `gen()`, and run them via `Scheduler.run()`. This module's only job is
// gluing the Restate SDK to the scheduler for production use.

import * as restate from "@restatedev/restate-sdk";
import type { Awaitable } from "./awaitable.js";
import type { Future, FutureValues, FutureSettledResult } from "./future.js";
import type { Channel } from "./channel.js";
import {
  type Operation,
  type SelectResult,
  spawn as spawnOp,
  select as selectOp,
} from "./operation.js";
import type { Scheduler } from "./scheduler.js";
import {
  type State,
  type SharedState,
  type TypedState,
  type UntypedState,
  makeState,
} from "./state.js";
import {
  type GenClient,
  type GenSendClient,
  makeClient,
  makeSendClient,
} from "./clients.js";
import {
  type GenDurablePromise,
  wrapDurablePromise,
} from "./durable-promise.js";
import type { Descriptor, HandlerDescriptor } from "./define.js";
import {
  InvocationReferenceImpl,
  type InvocationReference,
  type SignalReference,
} from "./invocation-reference.js";
import { gen } from "./operation.js";

// Adapt a real RestatePromise to our Awaitable interface. RestatePromise
// already has `.map((v, e) => U)` and is thenable, so the adapter is a
// structural pass-through.
function adapt<T>(p: restate.RestatePromise<T>): Awaitable<T> {
  return p as unknown as Awaitable<T>;
}

/**
 * Retry policy for `run`. Mirrors the SDK's `RunOptions` retry knobs
 * but namespaced (no `Retry` prefix on each field) and grouped under
 * `RunOpts.retry` for readability.
 */
export type RetryOptions = {
  /**
   * Max attempts (including the initial). When reached, `run` throws
   * a `TerminalError` wrapping the original error message.
   */
  maxAttempts?: number;
  /**
   * Max total duration of retries before giving up. Number is ms.
   */
  maxDuration?: restate.Duration | number;
  /**
   * First retry delay. Subsequent delays grow by `intervalFactor`.
   * Number is ms. Defaults to 50 ms.
   */
  initialInterval?: restate.Duration | number;
  /**
   * Cap on retry delay. Number is ms. Defaults to 10 s.
   */
  maxInterval?: restate.Duration | number;
  /**
   * Multiplier applied to the previous delay. Defaults to 2.
   */
  intervalFactor?: number;
};

/**
 * Options for `run`. Both fields are optional; if `name` is omitted,
 * the action's `Function.name` is used (works for named functions and
 * for arrow functions assigned to a `const` since JS infers names from
 * the binding site). If neither resolves, `run` throws.
 */
export type RunOpts<T> = {
  /** Journal entry name. Falls back to `action.name` if absent. */
  name?: string;
  /** Retry policy. Defaults to the SDK's defaults if absent. */
  retry?: RetryOptions;
  /** Custom serde for the journaled value. */
  serde?: restate.Serde<T>;
};

/**
 * Options object passed to the closure of `run(...)`. Carries an
 * AbortSignal that fires when invocation cancellation arrives.
 *
 * Using an object (rather than positional args) leaves room to extend
 * the closure's API surface — additional fields may be added later
 * without breaking existing closures.
 */
export type RunActionOpts = {
  readonly signal: AbortSignal;
};

/**
 * The closure that `run` invokes. Receives `{ signal }` — pass the
 * signal into AbortSignal-aware APIs (e.g. `fetch(url, { signal })`)
 * to cancel in-flight syscalls promptly.
 */
export type RunAction<T> = (opts: RunActionOpts) => Promise<T>;

/**
 * Wrap a user-supplied `run` closure to surface the abort reason
 * (typically a TerminalError(CANCELLED)) on throw paths if the signal
 * aborted during execution. This converts AbortError (and any other
 * abort-caused failure) into the canonical cancellation TerminalError
 * for journal recording.
 *
 * Defensive coercion: if `signal.reason` is itself not a TerminalError
 * (which shouldn't happen in production but might during testing or
 * with non-cancellation race rejections), we wrap it in one. The
 * journal must record a *terminal* outcome to avoid retries against
 * a cancelled invocation.
 *
 * Exposed for testing — the wrapper's behavior is the part that has
 * semantic bite, separate from the ctx.run plumbing.
 */
export function wrapActionForCancellation<T>(
  signal: AbortSignal,
  action: RunAction<T>
): () => Promise<T> {
  return async () => {
    try {
      return await action({ signal });
    } catch (e) {
      if (signal.aborted) {
        throw asTerminalError(signal.reason);
      }
      throw e;
    }
  };
}

/**
 * Resolve the journal-entry name; throw `TerminalError` if neither
 * source provides one.
 *
 * `TerminalError` (not a plain `Error`) because a missing name is a
 * programming bug — retrying the invocation will hit the same code
 * path and fail the same way. The SDK treats terminal errors as
 * non-retryable; the invocation fails fast instead of looping.
 */
function resolveRunName<T>(action: RunAction<T>, opts?: RunOpts<T>): string {
  const fromOpts = opts?.name?.trim();
  if (fromOpts) return fromOpts;
  const fromFn = action.name;
  if (fromFn) return fromFn;
  throw new restate.TerminalError(
    "@restatedev/restate-sdk-gen: run() requires a journal-entry name. " +
      "Either pass a named function (`run(myFn)`) or supply " +
      "`{ name: '...' }` in the second argument."
  );
}

/** Translate our `RetryOptions` into the SDK's flat `RunOptions` shape. */
function toSdkRunOptions<T>(opts?: RunOpts<T>): restate.RunOptions<T> {
  const out: restate.RunOptions<T> = {};
  if (opts?.serde !== undefined) out.serde = opts.serde;
  const r = opts?.retry;
  if (r) {
    if (r.maxAttempts !== undefined) out.maxRetryAttempts = r.maxAttempts;
    if (r.maxDuration !== undefined) out.maxRetryDuration = r.maxDuration;
    if (r.initialInterval !== undefined)
      out.initialRetryInterval = r.initialInterval;
    if (r.maxInterval !== undefined) out.maxRetryInterval = r.maxInterval;
    if (r.intervalFactor !== undefined)
      out.retryIntervalFactor = r.intervalFactor;
  }
  return out;
}

function asTerminalError(reason: unknown): restate.TerminalError {
  if (reason instanceof restate.TerminalError) return reason;
  // Non-Terminal reason: wrap as CancelledError. The SDK's CancelledError
  // is the canonical type for "invocation was cancelled" — TerminalError
  // subclass with the proper error code (409). The original reason is
  // discarded; defensible since this branch should never fire in
  // production (cancellation rejections from the SDK are always Terminal).
  return new restate.CancelledError();
}

export class RestateOperations {
  private readonly ctx: restate.internal.ContextInternal;
  private readonly sched: Scheduler;

  constructor(context: restate.Context, sched: Scheduler) {
    this.ctx = context as restate.internal.ContextInternal;
    this.sched = sched;
  }

  // Internal: wrap an SDK RestatePromise as a journal-backed Future.
  // Not part of the public surface — every primitive that needs it
  // (run/sleep/awakeable/typed clients/genericCall/workflowPromise)
  // funnels through here so the adapt + makeJournalFuture wiring
  // stays in one place.
  private toFuture<T>(p: restate.RestatePromise<T>): Future<T> {
    return this.sched.makeJournalFuture(adapt(p));
  }

  // ---- journal-backed Futures ----

  /**
   * Run a side-effecting closure as a journal entry.
   *
   * The closure receives `{ signal }` — an AbortSignal that fires when
   * invocation cancellation arrives. Pass it into AbortSignal-aware
   * APIs (e.g. `fetch(url, { signal })`) to abort in-flight syscalls.
   *
   * `name` is the journal entry's stable identifier (must be
   * deterministic across replay). It can come from either:
   *
   *   - `opts.name` — explicit override
   *   - `action.name` — the function's own name (works for `function`
   *     declarations and arrow functions assigned to a `const`,
   *     since JS infers names from the binding site)
   *
   * If neither resolves, `run` throws.
   *
   * @example Named function — name derived
   *   async function fetchUser({ signal }: RunActionOpts): Promise<User> {
   *     const r = await fetch(`/users/${id}`, { signal });
   *     return r.json();
   *   }
   *   yield* run(fetchUser);
   *
   * @example Named arrow — name derived from binding
   *   const fetchUser = async ({ signal }: RunActionOpts) => { ... };
   *   yield* run(fetchUser);
   *
   * @example Inline arrow — name explicit
   *   yield* run(async ({ signal }) => fetch(url, { signal }), { name: "fetch" });
   *
   * @example With retry policy
   *   yield* run(fetchUser, { retry: { maxAttempts: 3 } });
   *
   * Cancellation hygiene: if the closure throws while the signal is
   * aborted, we rethrow `signal.reason` (the original TerminalError)
   * instead of whatever the closure threw. This ensures the journal
   * entry records `TerminalError(CANCELLED)` rather than `AbortError`.
   */
  run<T>(action: RunAction<T>, opts?: RunOpts<T>): Future<T> {
    const name = resolveRunName(action, opts);
    const wrapped = wrapActionForCancellation(this.sched.abortSignal, action);
    return this.sched.makeJournalFuture(
      adapt(this.ctx.run(name, wrapped, toSdkRunOptions(opts)))
    );
  }

  sleep(duration: restate.Duration | number, name?: string): Future<void> {
    return this.sched.makeJournalFuture(adapt(this.ctx.sleep(duration, name)));
  }

  awakeable<T>(serde?: restate.Serde<T>): { id: string; promise: Future<T> } {
    const { id, promise } = this.ctx.awakeable(serde);
    return { id, promise: this.sched.makeJournalFuture(adapt(promise)) };
  }

  resolveAwakeable<T>(id: string, payload?: T, serde?: restate.Serde<T>) {
    this.ctx.resolveAwakeable(id, payload, serde);
  }

  rejectAwakeable(id: string, reason: string | restate.TerminalError) {
    this.ctx.rejectAwakeable(id, reason);
  }

  signal<T>(name: string, serde?: restate.Serde<T>): Future<T> {
    return this.sched.makeJournalFuture(adapt(this.ctx.signal(name, serde)));
  }

  attach<T>(
    invocationId: restate.InvocationId,
    serde?: restate.Serde<T>
  ): Future<T> {
    return this.sched.makeJournalFuture(
      adapt(this.ctx.attach(invocationId, serde))
    );
  }

  // ---- context accessor ----

  /**
   * Returns the current invocation's request metadata plus the optional
   * virtual-object / workflow key. The `key` field is only present when
   * the handler belongs to an object or workflow.
   */
  handlerRequest(): restate.Request & { key?: string } {
    const req = this.ctx.request();
    const key = (this.ctx as unknown as { key?: string }).key;
    return key !== undefined ? Object.assign(req, { key }) : req;
  }

  // ---- typed clients (call + send) backed by call()/send() ----

  /**
   * Unified client for any Descriptor (service, object, or workflow).
   * Each method yields a Future<O> backed by call().
   * For services, key is not needed. For objects/workflows, pass the key.
   */
  client<H extends Record<string, HandlerDescriptor>>(
    def: Descriptor<string, H, "service">
  ): GenClient<H>;
  client<H extends Record<string, HandlerDescriptor>>(
    def: Descriptor<string, H, "object" | "workflow">,
    key: string
  ): GenClient<H>;
  client(def: Descriptor<string, any, any>, key?: string): GenClient<any> {
    return makeClient(
      def,
      key,
      (o) => this.ctx.genericCall(o as any),
      (p) => this.toFuture(p),
      (h, s) =>
        this.invocationReferenceFromHandle(h as restate.InvocationHandle, s)
    ) as any;
  }

  /**
   * Fire-and-forget send client for any Descriptor.
   * Each method returns an InvocationHandle synchronously.
   */
  sendClient<H extends Record<string, HandlerDescriptor>>(
    def: Descriptor<string, H, "service">
  ): GenSendClient<H>;
  sendClient<H extends Record<string, HandlerDescriptor>>(
    def: Descriptor<string, H, "object" | "workflow">,
    key: string
  ): GenSendClient<H>;
  sendClient(
    def: Descriptor<string, any, any>,
    key?: string
  ): GenSendClient<any> {
    return makeSendClient(
      def,
      key,
      (o) => this.ctx.genericSend(o as any),
      (h, s) =>
        this.invocationReferenceFromHandle(h as restate.InvocationHandle, s)
    ) as any;
  }

  // ---- generic call/send (renamed from genericCall/genericSend) ----

  call<REQ = Uint8Array, RES = Uint8Array>(
    call: restate.GenericCall<REQ, RES>
  ): Future<RES> {
    return this.toFuture(this.ctx.genericCall<REQ, RES>(call));
  }

  send<REQ = Uint8Array>(
    call: restate.GenericSend<REQ>
  ): Future<InvocationReference<unknown>> {
    const handle = this.ctx.genericSend<REQ>(call);
    return this.invocationReferenceFromHandle(handle, undefined);
  }

  // ---- invocation reference helpers ----

  invocationReferenceFromHandle<O>(
    handle: restate.InvocationHandle,
    outputSerde: restate.Serde<O> | undefined
  ): Future<InvocationReference<O>> {
    // handle.invocationId is Promise<InvocationId> typed, but under the hood
    // it is a RestatePromise — adapt it to a journal-backed Future.
    const idFuture = this.toFuture(
      handle.invocationId as unknown as restate.RestatePromise<restate.InvocationId>
    );
    return this.sched.spawnDetached(
      gen(function* (): Generator<unknown, InvocationReference<O>, unknown> {
        const id = (yield* idFuture) as string;
        return new InvocationReferenceImpl<O>(id, outputSerde);
      })
    );
  }

  invocationSignal<T>(
    invocationId: restate.InvocationId,
    name: string,
    serde?: restate.Serde<T>
  ): SignalReference<T> {
    const internalCtx = this.ctx as unknown as restate.internal.ContextInternal;
    const ref = internalCtx.invocation(invocationId);
    return ref.signal<T>(name, serde) as SignalReference<T>;
  }

  // ---- cancel another invocation ----

  /**
   * Cancel another invocation by its id. To observe cancellation
   * arriving at *this* invocation, catch the `TerminalError` thrown by
   * the next `yield*` boundary or use the `signal` exposed inside
   * `ops.run` closures.
   */
  cancel(invocationId: restate.InvocationId): void {
    this.ctx.cancel(invocationId);
  }

  // ---- workflow durable promise ----

  /**
   * Workflow-bound durable promise. Use only inside a workflow handler
   * (the underlying context must be `WorkflowContext` or
   * `WorkflowSharedContext`). Returns a wrapper whose `peek`/`get`/
   * `resolve`/`reject` methods return Futures.
   */
  workflowPromise<T>(
    name: string,
    serde?: restate.Serde<T>
  ): GenDurablePromise<T> {
    const wfCtx = this.ctx as unknown as restate.WorkflowSharedContext;
    return wrapDurablePromise(wfCtx.promise<T>(name, serde), <U>(p: unknown) =>
      this.toFuture(p as restate.RestatePromise<U>)
    );
  }

  // ---- spawn ----

  spawn<T>(op: Operation<T>): Operation<Future<T>> {
    return spawnOp(op);
  }

  // ---- channels ----

  /**
   * Create a single-shot in-memory channel. Returns a Channel<T> with
   * `send(v)` (fire-and-forget, idempotent — first call settles, rest
   * are dropped) and `receive: Future<T>` (a stable settle-once Future,
   * the same handle on every access).
   *
   * Canonical use: cooperative cancellation. Spawn a routine that
   * selects over its work and `stop.receive`; the canceller calls
   * `stop.send()` to request termination. The receiver decides what
   * to do — return a partial result, do cleanup yields, ignore.
   *
   * Because `receive` is a stable, settle-once Future, multiple readers
   * all observe the same value (one-time broadcast) and the worker can
   * use it in every iteration of a select-loop without leaking orphan
   * receivers.
   *
   * Multi-event streams (producer-consumer, progress events) are NOT
   * supported — Channel is intentionally single-shot. A separate
   * primitive for that use case is yet to be designed.
   */
  channel<T>(): Channel<T> {
    return this.sched.makeChannel<T>();
  }

  // ---- state ----

  /**
   * Per-invocation read-write key-value store. Use from a handler whose
   * underlying context is ObjectContext or WorkflowContext.
   *
   * The optional `TState` generic gives keyof-checked names and per-key
   * value types:
   *
   *   ops.state<{count: number; user: User}>()
   *     // state.get("count") → Future<number | null>
   *
   * Without it, names are `string` and values are inferred per call:
   *
   *   ops.state()
   *     // state.get<number>("count") → Future<number | null>
   *
   * Calling write methods from a shared (read-only) context throws at
   * runtime — for shared handlers, use `sharedState()` below to get a
   * narrower type that drops the write methods.
   */
  state<TState extends TypedState = UntypedState>(): State<TState> {
    return makeState<TState>(
      this.ctx as unknown as restate.ObjectContext,
      this.sched,
      adapt
    );
  }

  /**
   * Per-invocation read-only key-value store. Use from a handler whose
   * underlying context is ObjectSharedContext or WorkflowSharedContext.
   *
   * Same `TState` generic as `state()`. Returns the read-only subset
   * (`get`, `keys`); attempting to call writes is a type error.
   */
  sharedState<TState extends TypedState = UntypedState>(): SharedState<TState> {
    return makeState<TState>(
      this.ctx as unknown as restate.ObjectSharedContext,
      this.sched,
      adapt
    );
  }

  // ---- combinators ----

  /**
   * Wait for every future to settle; return their values in input
   * order. Heterogeneous-tuple typing — `all([fA, fB])` where
   * `fA: Future<A>` and `fB: Future<B>` yields `Future<[A, B]>`.
   * Mirrors `Promise.all` from the standard lib.
   */
  all<const T extends readonly Future<unknown>[] | []>(
    futures: T
  ): Future<FutureValues<T>> {
    return this.sched.all(futures);
  }

  /**
   * Return the first future to settle; losers continue running but
   * their results are discarded. Heterogeneous-tuple typing —
   * `race([fA, fB])` yields `Future<A | B>`. Mirrors `Promise.race`.
   */
  race<const T extends readonly Future<unknown>[] | []>(
    futures: T
  ): Future<FutureValues<T>[number]> {
    return this.sched.race(futures);
  }

  /**
   * First-success combinator. Resolves with the first input that
   * succeeds (non-rejected); rejects with `AggregateError(errors)` when
   * every input rejects (including an empty input array). See `Promise.any`.
   *
   * Tuple-aware typing — `any([fA, fB])` where `fA: Future<A>` and
   * `fB: Future<B>` yields `Future<A | B>`.
   */
  any<const T extends readonly Future<unknown>[] | []>(
    futures: T
  ): Future<FutureValues<T>[number]> {
    return this.sched.any(futures);
  }

  /**
   * Settle-all combinator. Resolves with an array of
   * `FutureSettledResult` in input order; never rejects. See
   * `Promise.allSettled`.
   *
   * Tuple-aware typing — `allSettled([fA, fB])` yields
   * `Future<[FutureSettledResult<A>, FutureSettledResult<B>]>`.
   */
  allSettled<const T extends readonly Future<unknown>[] | []>(
    futures: T
  ): Future<{
    -readonly [P in keyof T]: FutureSettledResult<
      T[P] extends Future<infer U> ? U : never
    >;
  }> {
    return this.sched.allSettled(futures);
  }

  // Wait for one branch to settle, return its tag and the future itself.
  // The user unwraps the future after switching on the tag — `yield* r.future`
  // is effectively sync at that point since it's already settled.
  *select<B extends Record<string, Future<unknown>>>(
    branches: B
  ): Generator<unknown, SelectResult<B>, unknown> {
    return yield* selectOp(branches);
  }
}

// =============================================================================
// Production execute() entry point.
// =============================================================================

import { defaultLib } from "./default-lib.js";
import { Scheduler as SchedulerClass } from "./scheduler.js";

/**
 * Run a generator-based workflow against a Restate context.
 *
 * `op` is an `Operation<T>` — typically the result of
 * `gen(function*() { ... })`. Inside the generator body, reach for the
 * free-standing API (`run`, `sleep`, `all`, `state`, …) imported
 * from `@restatedev/restate-sdk-gen`. They read the active scheduler from a
 * synchronous current-fiber slot installed by `Fiber.advance`.
 *
 * `gen()` already takes a factory, so the same `Operation` is re-
 * iterable across multiple `execute()` calls — no need for a builder
 * lambda at this boundary.
 *
 * @example
 *   execute(ctx, gen(function* () {
 *     const greeting = yield* run(async () => "hi", { name: "compose" });
 *     return greeting;
 *   }));
 */
export async function execute<T>(
  context: restate.Context,
  op: Operation<T>
): Promise<T> {
  const sched = new SchedulerClass(defaultLib);
  // Publish a private `RestateOperations` on the scheduler so
  // `Fiber.advance` can install it on the module-level current-fiber
  // slot read by the free-standing API.
  sched.contextSlot = new RestateOperations(context, sched);
  return sched.run(op);
}
