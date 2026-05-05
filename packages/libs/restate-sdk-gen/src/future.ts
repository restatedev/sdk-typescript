// Future<T>
// =============================================================================
//
// One user-visible type. Two internal backings, distinguished only inside
// combinator implementations and the scheduler. The user sees uniform
// behavior — all Futures yield and compose the same way regardless of
// backing.
//
// Two kinds of backing:
//
//   - "journal" — wraps a remote promise (RestatePromise in production,
//     TestPromise in tests). Resolution is observed by Restate's runtime
//     and journaled. Goes through the scheduler's main-loop `lib.race`.
//
//   - "local" — wraps an in-memory `WaitTarget`. Resolution lives only
//     in the JS heap; never touches the journal, never goes through
//     `lib.race`. Fibers (settled by their iterator finishing) and
//     Channels (settled by `send()`) both implement `WaitTarget`.
//     Future in-memory primitives — semaphores, latches — slot in here
//     too without further changes to the scheduler/fiber.

import type { Awaitable } from "./awaitable.js";
import {
  type Operation,
  type PrimitiveOp,
  type LeafNode,
  makePrimitive,
} from "./operation.js";
import type { Settled, Waiter } from "./scheduler-types.js";

// `futureBacking` is the symbol slot where each Future stashes its backing
// (journal-backed promise or local WaitTarget). NOT exported from index.ts:
// the symbol-keyed property is an implementation detail, accessed only by
// the scheduler/fiber via the internal `getBacking` helper below.
export const futureBacking = Symbol("restateFutureBacking");

export type JournalBacking<T> = {
  readonly kind: "journal";
  readonly promise: Awaitable<T>;
};

/**
 * In-memory completion source. Anything that gets settled exactly once
 * and notifies waiters can be a `WaitTarget` — fibers, channels, and
 * any future in-memory primitive we add (latch, semaphore, …).
 *
 * Contract mirrors `Fiber`'s lifecycle methods:
 *   - `isDone()` and `settledValue()` for a synchronous short-circuit
 *     when the target is already settled at park time.
 *   - `awaitCompletion(waiter)` registers a one-shot callback;
 *     returns the settled value if already done so the caller can
 *     short-circuit without queuing.
 */
export interface WaitTarget<T> {
  isDone(): boolean;
  settledValue(): Settled;
  awaitCompletion(waiter: Waiter): Settled | null;
  // The generic parameter T is documentation; the concrete settle path
  // already carries the value via `Settled`. Kept on the interface so
  // call-site types match `Fiber<T>` / `ChannelImpl<T>` cleanly.
  readonly _phantom?: T;
}

export type LocalBacking<T> = {
  readonly kind: "local";
  readonly target: WaitTarget<T>;
};

export type Backing<T> = JournalBacking<T> | LocalBacking<T>;

// Public Future is opaque — only the iterable shape is visible. The
// `[futureBacking]: Backing<T>` storage lives on the internal type, kept
// off the published API so we don't drag JournalBacking/LocalBacking/
// WaitTarget/Awaitable/Settled/Waiter into the public surface.
export interface Future<T> extends Operation<T> {}

/**
 * Internal shape — Future plus its symbol-keyed backing slot. Kept off
 * the public `Future<T>` interface so `Backing`/`JournalBacking`/
 * `LocalBacking`/`WaitTarget` (and their transitive deps) don't leak
 * into the published `.d.ts`.
 */
export interface FutureWithBacking<T> extends Future<T> {
  readonly [futureBacking]: Backing<T>;
}

/** Like `FutureWithBacking<T>` but narrowed to a journal backing. */
export interface JournalBackedFuture<T> extends Future<T> {
  readonly [futureBacking]: JournalBacking<T>;
}

/**
 * Internal accessor — read the backing off a Future. Only the scheduler
 * and fiber call this; user code never sees Backing.
 */
export function getBacking<T>(f: Future<T>): Backing<T> {
  return (f as FutureWithBacking<T>)[futureBacking];
}

export function makeFuture<T>(backing: Backing<T>): Future<T> {
  // Each Future carries a single Leaf op that the scheduler dispatches on.
  // Reused across [Symbol.iterator]() calls since it's stateless — just a
  // back-reference to this future for the scheduler to inspect.
  //
  // The forward-reference inside the iterator closure is safe: the
  // generator body only runs when [Symbol.iterator]() is iterated, which
  // can only happen after this function returns and `leafOp` is bound.
  const future: FutureWithBacking<T> = {
    [futureBacking]: backing,
    *[Symbol.iterator]() {
      return (yield leafOp) as T;
    },
  };
  const leafOp: PrimitiveOp<T> = makePrimitive<T>({
    _tag: "Leaf",
    future,
  } as LeafNode<T>);
  return future;
}

export function isJournalBacked<T>(f: Future<T>): f is JournalBackedFuture<T> {
  return getBacking(f).kind === "journal";
}

// =============================================================================
// Helper types for heterogeneous combinator inputs.
// =============================================================================
//
// `all([fA, fB, fC])` where each Future has a different value type
// should yield `[A, B, C]`, not `(A | B | C)[]`. Mirrors the standard
// lib's `Promise.all` pattern (see `lib.es2015.iterable.d.ts`):
//
//   all<T extends readonly unknown[] | []>(values: T):
//     Promise<{ -readonly [P in keyof T]: Awaited<T[P]> }>
//
// Same idea here, but unwrapping `Future<U>` to `U` instead of
// awaiting a Promise.

/** Extract the value type from a `Future<U>`; `never` for non-Futures. */
export type FutureValue<F> = F extends Future<infer U> ? U : never;

/**
 * Map a tuple of Futures to the tuple of their value types.
 * For `[Future<A>, Future<B>]` produces `[A, B]`.
 * For an unbounded `Future<X>[]` produces `X[]`.
 */
export type FutureValues<T extends readonly Future<unknown>[] | []> = {
  -readonly [P in keyof T]: T[P] extends Future<infer U> ? U : never;
};

// =============================================================================
// FutureSettledResult variants — re-declared here with `reason: unknown`
// instead of the std-lib's `reason: any`, which leaks `any` into allSettled's
// return type and every caller that pattern-matches on the result.
// =============================================================================

export interface FutureFulfilledResult<T> {
  readonly status: "fulfilled";
  readonly value: T;
}

export interface FutureRejectedResult {
  readonly status: "rejected";
  readonly reason: unknown;
}

export type FutureSettledResult<T> =
  | FutureFulfilledResult<T>
  | FutureRejectedResult;
