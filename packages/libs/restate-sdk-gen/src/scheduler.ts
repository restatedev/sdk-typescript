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

// Scheduler
// =============================================================================
//
// The runtime that drives Operations. Decoupled from Restate via the
// Awaitable abstraction — production wires it to RestatePromise, tests
// wire it to a hand-controlled promise type.
//
// The scheduler's job is orchestration:
//
//   - Maintain the set of live fibers.
//   - Maintain the ready queue (which fibers want to run next).
//   - Run the main loop: assemble the parked sources from every live
//     fiber, race them via the lib, dispatch the winner.
//   - Broadcast invocation cancellation when the race rejects.
//   - Construct journal-backed and routine-backed Futures for users.
//
// The fiber's job is execution. The boundary between Scheduler and
// Fiber is narrow (see `fiber.ts` and `SchedulerOps` interface).

import type { Awaitable, AwaitableLib } from "./awaitable.js";
import {
  type Future,
  type FutureValue,
  type FutureValues,
  type FutureSettledResult,
  futureBacking,
  makeFuture,
  isJournalBacked,
} from "./future.js";
import { type Operation, awaitRace, gen } from "./operation.js";
import type { Settled, PromiseSource } from "./scheduler-types.js";
import { Fiber, type SchedulerOps } from "./fiber.js";
import { type Channel, makeChannel } from "./channel.js";

export class Scheduler implements SchedulerOps {
  private readonly fibers: Set<Fiber<unknown>> = new Set();
  private readonly ready: Fiber<unknown>[] = [];
  private readonly lib: AwaitableLib;
  // Replaced (not just re-aborted) each time the scheduler observes
  // invocation cancellation. AbortControllers are one-way — once
  // aborted, signal.aborted stays true forever — so the scheduler-
  // level signal must be a fresh controller per cancel event to
  // preserve recoverability. Closures that captured the old signal
  // still see it as aborted (correctly, since their work was caught
  // by the cancellation); closures created after recovery see the new,
  // unaborted signal.
  private abortController: AbortController = new AbortController();
  /**
   * Slot for the RestateOperations bound to this scheduler. Set by
   * `execute()` after construction (we can't pass it into the ctor
   * because RestateOperations needs the scheduler to construct itself).
   * `Fiber.advance` publishes this to the module-level current-fiber
   * slot read by free-standing API functions. Typed `unknown` here to
   * keep this module independent of `restate-operations.ts`.
   */
  contextSlot: unknown = null;

  constructor(lib: AwaitableLib) {
    this.lib = lib;
  }

  /**
   * The scheduler's current AbortSignal. Aborts when invocation
   * cancellation is observed (the SDK rejects the main race promise
   * with TerminalError). After cancellation has been delivered to
   * fibers and the scheduler has resumed, this getter returns a
   * *fresh* signal — one that is not aborted, even though the previous
   * cancel was just delivered.
   *
   * Pass `signal` to AbortSignal-aware APIs in `ops.run` closures
   * (e.g. `fetch(url, {signal})`) so they cancel promptly when the
   * surrounding work is cancelled. Cleanup closures yielded after a
   * caught CancelledError get a fresh, unaborted signal — so they can
   * do real work and only abort if a *new* cancellation arrives.
   */
  get abortSignal(): AbortSignal {
    return this.abortController.signal;
  }

  // ---- SchedulerOps: narrow interface for Fiber ----

  markReady(f: Fiber<unknown>): void {
    this.ready.push(f);
  }

  markDone(f: Fiber<unknown>): void {
    // Remove from the live set so long-running loops that spawn (e.g.,
    // race in a while-true) don't accumulate dead-fiber objects. Safe
    // here because markDone is called from Fiber.advance, which only
    // runs between main-loop awaits — no other code is iterating
    // `fibers` now.
    this.fibers.delete(f);
  }

  spawnFuture<U>(op: Operation<U>): Future<U> {
    const f = this.createFiber(op);
    return makeFuture<U>({ kind: "local", target: f });
  }

  private createFiber<U>(op: Operation<U>): Fiber<U> {
    const f = new Fiber<U>(op, this);
    this.fibers.add(f as Fiber<unknown>);
    this.ready.push(f as Fiber<unknown>);
    return f;
  }

  // ---- public construction helpers ----

  makeJournalFuture<U>(promise: Awaitable<U>): Future<U> {
    return makeFuture<U>({ kind: "journal", promise });
  }

  /**
   * Spawn an operation as a fresh fiber and return a Future that
   * resolves with its eventual value. Same as the SchedulerOps method;
   * exposed publicly for external callers (combinator helpers, the
   * main run() entry point).
   */
  spawnDetached<U>(op: Operation<U>): Future<U> {
    return this.spawnFuture(op);
  }

  /**
   * Construct a single-shot in-memory channel. Send must be called from
   * a fiber currently advancing under this scheduler. See `channel.ts`
   * for full semantics.
   */
  makeChannel<U>(): Channel<U> {
    return makeChannel<U>();
  }

  // ---- combinator helpers (used by RestateOperations) ----

  /**
   * Combinator over Futures. Fast path when every input is journal-
   * backed: use the lib's all/race for a single combinator entry.
   * Otherwise, fall back to a synthesized fiber that yields each in
   * turn.
   *
   * Tuple-aware typing (mirrors `Promise.all` in the standard lib):
   * `all([fA, fB])` where `fA: Future<A>` and `fB: Future<B>`
   * yields `Future<[A, B]>`, not `Future<(A | B)[]>`. The `const T`
   * lets TS infer a tuple from a literal array.
   */
  all<const T extends readonly Future<unknown>[] | []>(
    futures: T
  ): Future<FutureValues<T>> {
    // Cast to a uniform shape so `every(isJournalBacked)`'s type
    // predicate narrows elements correctly; the input tuple's
    // heterogeneous element types are recovered via the return cast.
    const fs = futures as ReadonlyArray<Future<unknown>>;
    if (fs.every(isJournalBacked)) {
      const promises = fs.map((f) => f[futureBacking].promise);
      return this.makeJournalFuture(this.lib.all(promises)) as Future<
        FutureValues<T>
      >;
    }
    return this.spawnDetached(
      gen<FutureValues<T>>(function* () {
        const out: unknown[] = new Array(fs.length);
        for (let i = 0; i < fs.length; i++) {
          // In case of failure, this throws, respecting the contract that all shortcircuits on failure
          out[i] = yield* fs[i]!;
        }
        return out as FutureValues<T>;
      })
    );
  }

  race<const T extends readonly Future<unknown>[] | []>(
    futures: T
  ): Future<FutureValues<T>[number]> {
    type R = FutureValues<T>[number];
    const fs = futures as ReadonlyArray<Future<unknown>>;
    // No need here to try downcasting to RestateFuture's, awaitRace will anyway produce the same UnresolvedFuture tree!
    return this.spawnDetached(
      gen<R>(function* () {
        const result = yield* awaitRace(fs);
        if (result.settled.ok) return result.settled.v as R;
        throw result.settled.e;
      })
    );
  }

  /**
   * First-success combinator. Mirrors `Promise.any` /
   * `RestatePromise.any`: settles with the first input that succeeds
   * (non-rejected); rejects with `AggregateError(errors)` when every
   * input rejects (including the empty-array case).
   *
   * Fast path collapses to a single `lib.any` over journal awaitables.
   * Fallback synthesizes a fiber that loops `awaitAnyOf` over the
   * still-pending subset, accumulating rejections in input order until
   * one input fulfills or all have rejected.
   *
   * Tuple-aware: `any([fA, fB])` where `fA: Future<A>` and `fB:
   * Future<B>` yields `Future<A | B>` (the union of slot types), same
   * shape as `Promise.any`.
   */
  any<const T extends readonly Future<unknown>[] | []>(
    futures: T
  ): Future<FutureValues<T>[number]> {
    type R = FutureValues<T>[number];
    const fs = futures as ReadonlyArray<Future<unknown>>;
    if (fs.every(isJournalBacked)) {
      const promises = fs.map((f) => f[futureBacking].promise);
      return this.makeJournalFuture(this.lib.any(promises)) as Future<R>;
    }
    return this.spawnDetached(
      gen<R>(function* () {
        const errors: unknown[] = new Array(fs.length);
        const remaining = new Set<number>();
        for (let i = 0; i < fs.length; i++) remaining.add(i);
        while (remaining.size > 0) {
          const liveIdx = Array.from(remaining);
          const live = liveIdx.map((i) => fs[i]!);
          const result = yield* awaitRace(live);
          const original = liveIdx[result.index]!;
          if (result.settled.ok) return result.settled.v as R;
          errors[original] = result.settled.e;
          remaining.delete(original);
        }
        throw new AggregateError(errors, "All promises were rejected");
      })
    );
  }

  /**
   * Settle-all combinator. Mirrors `Promise.allSettled` /
   * `RestatePromise.allSettled`: resolves with an array of
   * `FutureSettledResult` in input order, never rejects.
   *
   * Fast path collapses to a single `lib.allSettled`. Fallback yields
   * each Future in turn — safe because Futures are eager (already in
   * flight); sequential harvesting just reads them as they complete
   * without blocking concurrency.
   *
   * Tuple-aware: `allSettled([fA, fB])` yields
   * `Future<[FutureSettledResult<A>, FutureSettledResult<B>]>`.
   */
  allSettled<const T extends readonly Future<unknown>[] | []>(
    futures: T
  ): Future<{
    -readonly [P in keyof T]: FutureSettledResult<FutureValue<T[P]>>;
  }> {
    type R = {
      -readonly [P in keyof T]: FutureSettledResult<FutureValue<T[P]>>;
    };
    const fs = futures as ReadonlyArray<Future<unknown>>;
    if (fs.every(isJournalBacked)) {
      const promises = fs.map((f) => f[futureBacking].promise);
      return this.makeJournalFuture(this.lib.allSettled(promises)) as Future<R>;
    }
    return this.spawnDetached(
      gen<R>(function* () {
        const out = new Array<FutureSettledResult<unknown>>(fs.length);
        for (let i = 0; i < fs.length; i++) {
          try {
            const value = yield* fs[i]!;
            out[i] = { status: "fulfilled", value };
          } catch (reason) {
            out[i] = { status: "rejected", reason };
          }
        }
        return out as R;
      })
    );
  }

  // ---- driving ----

  private drainReady(): void {
    while (this.ready.length > 0) this.ready.shift()!.advance();
  }

  /**
   * Run an operation to completion. Drain the ready queue, then loop:
   * collect every PromiseSource from every parked fiber, race them,
   * dispatch the winner via its fire callback, drain. Stop when no
   * fiber is alive.
   */
  async run<T>(op: Operation<T>): Promise<T> {
    const main = this.createFiber(op);
    this.drainReady();

    while (this.fibers.size > 0) {
      const items: PromiseSource[] = [];
      for (const f of this.fibers) {
        for (const src of f.parkedSources()) items.push(src);
      }
      if (items.length === 0) {
        // Live fibers exist but no journal promises are pending — a
        // wait-cycle deadlock, or fibers parked only on routine waiters
        // whose targets can't progress.
        throw new Error(
          "scheduler stuck: live fibers but nothing pending on a journal promise"
        );
      }

      const tagged = items.map(({ promise }, i) =>
        promise.map((v, e): { i: number } & Settled =>
          e !== undefined ? { i, ok: false, e } : { i, ok: true, v }
        )
      );

      // The race promise itself can be settled with a rejection by
      // the SDK when invocation cancellation arrives. Per-source
      // promises are unaffected — the rejection lives on this
      // aggregate race promise. We fan the rejection out to every
      // parked fiber: each was, in effect, contributing a source to
      // this race, so each gets the TerminalError delivered at its
      // current yield point. Fibers may catch and continue normally;
      // subsequent iterations build fresh race promises that are not
      // infected by this rejection.
      //
      // Before fanning out, abort the current AbortController so
      // in-flight syscalls inside ops.run closures (those listening
      // on the captured signal) start cancelling immediately. Then
      // replace the controller with a fresh one so that closures
      // created during recovery (cleanup yields, etc.) see an
      // unaborted signal — cancellation is not a sticky state.
      let raceWinner: { i: number } & Settled;
      try {
        raceWinner = (await this.lib.race(tagged)) as { i: number } & Settled;
      } catch (e) {
        if (this.lib.isCancellation(e)) {
          this.abortController.abort(e);
          this.abortController = new AbortController();
        }
        const errSettled: Settled = { ok: false, e };
        for (const it of items) it.fire(errSettled);
        this.drainReady();
        continue;
      }

      const { i, ...settledFields } = raceWinner;
      const settled: Settled = settledFields.ok
        ? { ok: true, v: settledFields.v }
        : { ok: false, e: settledFields.e };
      items[i]!.fire(settled);
      this.drainReady();
    }

    if (!main.isDone()) {
      throw new Error("scheduler exited but main fiber never completed");
    }
    const final = main.settledValue();
    if (final.ok) return final.v as T;
    throw final.e;
  }
}
