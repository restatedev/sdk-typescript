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

// Fiber<T>
// =============================================================================
//
// A single strand of cooperative execution. Owns its iterator, its
// lifecycle state (ready / parked / done), and its waiter list. The
// scheduler orchestrates many fibers: keeping a ready queue, polling
// parked fibers' sources, telling fibers to advance.
//
// Design boundary:
//
//   Fiber owns:    iterator, state transitions, dispatch of yielded
//                  Leaf/Spawn/AwaitAny ops, waiter notification.
//   Scheduler owns: the set of live fibers, the ready queue, the
//                  Awaitable lib (race/all primitives), the main loop,
//                  and cancellation broadcast.
//
// Communication is narrow:
//
//   Scheduler → Fiber:    new Fiber(op, sched), fiber.advance(),
//                         fiber.wake(resume), fiber.parkedSources(),
//                         fiber.awaitCompletion(waiter), fiber.isDone(),
//                         fiber.settledValue().
//   Fiber → Scheduler:    sched.markReady(this), sched.markDone(this),
//                         sched.spawn(childOp).

import type { Operation, PrimitiveOp, LeafNode } from "./operation.js";
import { opTag } from "./operation.js";
import type { Future, Backing, WaitTarget } from "./future.js";
import { getBacking } from "./future.js";
import type { Settled, PromiseSource, Waiter } from "./scheduler-types.js";
import { setCurrent, clearCurrent } from "./current.js";

/**
 * Narrow interface a Fiber needs from its scheduler. Avoids a wide
 * coupling to Scheduler's full API; Fiber only ever calls these three.
 */
export interface SchedulerOps {
  markReady(f: Fiber<unknown>): void;
  markDone(f: Fiber<unknown>): void;
  /**
   * Spawn an operation as a fresh fiber and return a Future that
   * resolves with the fiber's eventual outcome. The fiber is added to
   * the scheduler's live set; the Future is what user code yields on.
   */
  spawnFuture<U>(op: Operation<U>): Future<U>;
  /**
   * The "current fiber" slot — the value installed by `execute()` as
   * the active `RestateOperations`. `Fiber.advance` publishes this to
   * the module-level slot so free-standing API functions can read it.
   * Typed `unknown` to avoid cycles with `restate-operations.ts`.
   */
  readonly contextSlot: unknown;
}

type FiberState =
  | { kind: "ready"; resume: Settled | null }
  | { kind: "parked"; promises: PromiseSource[] }
  | { kind: "done"; settled: Settled };

export class Fiber<T = unknown> implements WaitTarget<T> {
  private readonly it: Iterator<unknown, unknown, unknown>;
  private readonly sched: SchedulerOps;
  private state: FiberState = { kind: "ready", resume: null };
  private waiters: Waiter[] = [];

  constructor(op: Operation<T>, sched: SchedulerOps) {
    this.it = op[Symbol.iterator]() as Iterator<unknown, unknown, unknown>;
    this.sched = sched;
  }

  // ---- lifecycle queries ----

  isDone(): boolean {
    return this.state.kind === "done";
  }

  /**
   * For a fiber known to be done, return its settled outcome. Throws
   * if called on a non-done fiber — callers must check `isDone()` first
   * (or use `awaitCompletion` for the polymorphic version).
   */
  settledValue(): Settled {
    if (this.state.kind !== "done") {
      throw new Error("Fiber.settledValue called on non-done fiber");
    }
    return this.state.settled;
  }

  /**
   * Returns the parked sources this fiber is currently racing against.
   * Empty if the fiber is parked only on routine waiters (e.g.,
   * waiting on a sibling fiber to finish), or in any non-parked state.
   * The scheduler reads these to assemble its main-loop race.
   */
  parkedSources(): readonly PromiseSource[] {
    return this.state.kind === "parked" ? this.state.promises : [];
  }

  /**
   * "I want to be notified when this fiber is done." If the fiber is
   * already done, returns its settled outcome immediately (caller
   * should NOT also expect the waiter to be invoked). Otherwise
   * returns null and queues the waiter for invocation when the fiber
   * eventually finishes.
   */
  awaitCompletion(waiter: Waiter): Settled | null {
    if (this.state.kind === "done") return this.state.settled;
    this.waiters.push(waiter);
    return null;
  }

  // ---- driving ----

  /**
   * Wake this fiber with a resume value. Transitions to ready and
   * notifies the scheduler. May be called from any state except done
   * (waking a done fiber is a programming error and is ignored
   * defensively).
   */
  wake(resume: Settled | null): void {
    if (this.state.kind === "done") return;
    this.state = { kind: "ready", resume };
    this.sched.markReady(this);
  }

  /**
   * Drive the fiber's iterator until it parks (yields a primitive
   * whose dispatch ends with the fiber waiting on a source) or
   * finishes (returns or throws).
   *
   * No-op if the fiber is not in the ready state — protects against
   * stale entries in the scheduler's ready queue.
   */
  advance(): void {
    if (this.state.kind !== "ready") return;
    // Publish the scheduler's RestateOperations slot to the module-level
    // pointer that free-standing API functions (sleep, run, all, …)
    // read. The slot lifetime is exactly the synchronous span of this
    // method; restored in `finally` so concurrent schedulers (different
    // execute() calls) don't clobber each other.
    const prevSlot = setCurrent(this.sched.contextSlot);
    try {
      let resume: Settled | null = this.state.resume;
      while (true) {
        let next: IteratorResult<unknown, unknown>;
        try {
          next = stepIterator(this.it, resume);
        } catch (e) {
          this.finish({ ok: false, e });
          return;
        }
        if (next.done) {
          this.finish({ ok: true, v: next.value });
          return;
        }

        const op = next.value as PrimitiveOp<unknown>;
        const node = op[opTag];
        // Each branch returns null to mean "I parked, the fiber is
        // suspended" or a Settled to mean "resume the iterator with
        // this value." The Spawn case never parks; Leaf and AwaitAny
        // may or may not depending on whether their target is already
        // settled.
        let outcome: Settled | null;
        switch (node._tag) {
          case "Leaf":
            outcome = this.parkOnLeaf(node);
            break;
          case "Spawn":
            outcome = {
              ok: true,
              v: this.sched.spawnFuture(node.child),
            };
            break;
          case "AwaitRace":
            outcome = this.parkOnAwaitRace(node.futures);
            break;
        }

        if (outcome === null) return;
        resume = outcome;
      }
    } finally {
      clearCurrent(prevSlot);
    }
  }

  // ---- yield dispatch ----

  /**
   * Park on a single Future, or short-circuit if the Future is already
   * settled. Returns the Settled value to feed back into the iterator
   * if a short-circuit is possible (routine-backed future whose target
   * already finished); returns null if the fiber is parked and the
   * caller should suspend.
   */
  private parkOnLeaf(leaf: LeafNode<unknown>): Settled | null {
    const backing: Backing<unknown> = getBacking(leaf.future);
    if (backing.kind === "journal") {
      this.state = {
        kind: "parked",
        promises: [{ promise: backing.promise, fire: (s) => this.wake(s) }],
      };
      return null;
    }
    // Local-backed: ask the target (fiber, channel, etc.) to either
    // give us its settled outcome (sync short-circuit) or register us
    // as a waiter.
    const settled = backing.target.awaitCompletion((s) => this.wake(s));
    if (settled !== null) return settled;
    this.state = { kind: "parked", promises: [] };
    return null;
  }

  /**
   * Park on the first-to-settle of a list of Futures, or short-circuit
   * if any source is already settled. Returns `{index, settled}`
   * (wrapped as Settled) on short-circuit, or null if parked.
   *
   * On the parked path, every source registers a one-shot fire
   * callback that wakes the fiber with `{index, settled}`. The `won`
   * flag guards against duplicate wakes when multiple sources settle
   * in the same tick. Local sources (fibers, channels) park on the
   * target's waiter list; journal sources race in the main loop's
   * race promise.
   */
  private parkOnAwaitRace(
    futures: ReadonlyArray<Future<unknown>>
  ): Settled | null {
    // Sync-check first: a local source whose target is already done
    // wins immediately. Journal sources can't be sync-checked — they
    // always defer to the race.
    for (let i = 0; i < futures.length; i++) {
      const b = getBacking(futures[i]!);
      if (b.kind === "local" && b.target.isDone()) {
        return { ok: true, v: { index: i, settled: b.target.settledValue() } };
      }
    }

    let won = false;
    const promises: PromiseSource[] = [];
    for (let i = 0; i < futures.length; i++) {
      const idx = i;
      const b = getBacking(futures[i]!);
      const fireOnce = (settled: Settled) => {
        if (won) return;
        won = true;
        this.wake({ ok: true, v: { index: idx, settled } });
      };
      if (b.kind === "local") {
        // The target may already be done — but we sync-checked above
        // and short-circuited if so. So awaitCompletion here will queue
        // the waiter (returning null). We ignore its return.
        b.target.awaitCompletion(fireOnce);
      } else {
        promises.push({ promise: b.promise, fire: fireOnce });
      }
    }
    this.state = { kind: "parked", promises };
    return null;
  }

  // ---- termination ----

  /**
   * Iterator finished or threw. Transition to done, fire all waiters
   * with the settled outcome, notify scheduler.
   */
  private finish(settled: Settled): void {
    this.state = { kind: "done", settled };
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w(settled);
    this.sched.markDone(this);
  }
}

/**
 * Drive a generator iterator one step, feeding it whatever value or
 * exception the caller is resuming with. `resume === null` is the
 * very first step; `{ok: true, v}` resumes with a value; `{ok: false,
 * e}` throws into the iterator (or, if the iterator has no `throw`
 * method, rethrows so the fiber fails).
 */
function stepIterator(
  it: Iterator<unknown, unknown, unknown>,
  resume: Settled | null
): IteratorResult<unknown, unknown> {
  if (resume === null) return it.next(undefined);
  if (resume.ok) return it.next(resume.v);
  if (it.throw) return it.throw(resume.e);
  throw resume.e;
}
