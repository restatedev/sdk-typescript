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
//                  Leaf/AwaitRace ops, waiter notification.
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
//   Fiber → Scheduler:    sched.markReady(this), sched.markDone(this).
//
// Invariants (the rules that make the rest reason-about-able):
//
//   I1. A generator step runs ONLY inside `advance`, which the scheduler
//       calls ONLY from `drainReady`. `wake`, source `fire` callbacks,
//       and `finish`'s waiter notifications never run a step — they only
//       set state to `ready` and enqueue. So at most one fiber's body
//       runs at any instant (cooperative, single-threaded).
//   I2. `wake` is the sole transition into `ready`, and it bumps `epoch`
//       — the park-episode id. A waiter registered while parked is valid
//       only for that episode; once the fiber wakes (epoch advances) the
//       waiter is void. `epochGuarded` enforces this.
//   I3. A parked fiber normally leaves `parked` only when one of its own
//       sources fires. `interrupt`/cancellation are the exceptions: they
//       wake it OUT OF BAND, reusing the same resume path. The epoch
//       guard (stale waiters) and the `wokenDuringStep` check in
//       `advance` (self-interrupt) exist solely to keep those out-of-band
//       wakes safe.
//   I4. Journal-source fires need no epoch guard: the scheduler
//       re-collects parked sources fresh every tick, so a journal source
//       fires only in the tick it was collected, before the owner can
//       move on. Local waiters (channels, sibling fibers) are pruned by
//       nothing, so they MUST be epoch-guarded.

import type { Operation, PrimitiveOp, LeafNode } from "./operation.js";
import { opTag } from "./operation.js";
import type { Future, Backing, WaitTarget } from "./future.js";
import { getBacking } from "./future.js";
import type { Settled, PromiseSource, Waiter } from "./scheduler-types.js";
import { setCurrent, clearCurrent } from "./current.js";
import { linkAbortController } from "./abort.js";

/**
 * Narrow interface a Fiber needs from its scheduler. Avoids a wide
 * coupling to Scheduler's full API; Fiber only ever calls these.
 */
export interface SchedulerOps {
  markReady(f: Fiber<unknown>): void;
  markDone(f: Fiber<unknown>): void;
  /**
   * The "current fiber" slot — the value installed by `execute()` as
   * the active `RestateOperations`. `Fiber.advance` publishes this to
   * the module-level slot so free-standing API functions can read it.
   * Typed `unknown` to avoid cycles with `restate-operations.ts`.
   */
  readonly contextSlot: unknown;
  /**
   * The scheduler's current AbortSignal. A fiber's per-fiber run signal
   * is a child of this, so invocation cancellation / attempt-end cascade
   * into in-flight `run` closures (see `Fiber.runSignal`).
   */
  readonly abortSignal: AbortSignal;
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
  /**
   * Monotonic park-episode id, bumped on every `wake` (invariant I2).
   * Consumed by `epochGuarded` (waiter validity) and `wokenDuringStep`
   * (self-interrupt detection). Generalizes the old per-AwaitRace `won`
   * flag into a persistent, per-fiber guard.
   */
  private epoch = 0;
  /**
   * Whether the generator has been started (`it.next()` called at least
   * once). `it.throw()` on a not-yet-started generator propagates the
   * error out *without* running any body code, bypassing the routine's
   * own try/catch/finally — so an interrupt delivered before the first
   * advance must prime the generator first (see `stepIterator`).
   */
  private started = false;
  /**
   * Lazily-created AbortController for this fiber's `run` closures. Born
   * a child of the scheduler's current signal (so invocation cancellation
   * / attempt-end abort it) and aborted directly by `interrupt`. Recreated
   * when aborted, so cleanup `run`s after a swallowed interrupt see a
   * fresh, unaborted signal. Null until the fiber first needs a run signal.
   */
  private runController: AbortController | null = null;
  /**
   * Spawn-tree links. `parent` is the fiber that was advancing when this
   * one was created; `children` are the fibers it spawned (including the
   * synth fibers behind combinator fallbacks). `interrupt` cascades down
   * `children`; `finish` prunes from `parent` so the set tracks only live
   * descendants.
   */
  private readonly parent: Fiber<unknown> | null;
  private readonly children = new Set<Fiber<unknown>>();

  constructor(
    op: Operation<T>,
    sched: SchedulerOps,
    parent: Fiber<unknown> | null = null
  ) {
    this.it = op[Symbol.iterator]() as Iterator<unknown, unknown, unknown>;
    this.sched = sched;
    this.parent = parent;
    parent?.children.add(this as Fiber<unknown>);
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
   *
   * Bumps the park epoch so any waiters left registered on the targets
   * of the park we're leaving become stale no-ops (see `epoch`).
   */
  wake(resume: Settled | null): void {
    if (this.state.kind === "done") return;
    this.epoch++;
    this.state = { kind: "ready", resume };
    this.sched.markReady(this);
  }

  /**
   * Wrap a handler as a waiter that fires only while the fiber is still
   * in the park episode that registered it (see `epoch`, invariant I2).
   * A waiter left on a target after the fiber moved on — a re-park after
   * interrupt, or a losing race source — becomes a no-op. This is the
   * single mechanism behind both the AwaitRace "first source wins" dedup
   * and the cross-episode stale-waiter guard.
   */
  private epochGuarded(handler: (s: Settled) => void): Waiter {
    const at = this.epoch;
    return (s) => {
      if (this.epoch !== at) return;
      handler(s);
    };
  }

  /**
   * Whether a re-entrant `wake` fired during the step that began at
   * `epochBefore` — i.e. the fiber interrupted *itself* while advancing
   * (the only wake that can target the currently-advancing fiber). It
   * leaves a fresh resume in `this.state` to deliver at this yield rather
   * than parking on the op the body just produced.
   */
  private wokenDuringStep(epochBefore: number): boolean {
    return this.epoch !== epochBefore && this.state.kind === "ready";
  }

  /**
   * The AbortSignal handed to this fiber's `run` closures. Lazily
   * created as a child of the scheduler's current signal, so invocation
   * cancellation and attempt-end abort it like before; additionally,
   * `interrupt` aborts it directly to stop just this fiber's in-flight
   * I/O. Recreated once aborted, so a `run` issued after a swallowed
   * interrupt (or after cancellation recovery) gets a fresh signal.
   */
  runSignal(): AbortSignal {
    if (this.runController === null || this.runController.signal.aborted) {
      this.runController = linkAbortController(this.sched.abortSignal);
    }
    return this.runController.signal;
  }

  /**
   * Throw `err` into this fiber at its next yield point, and abort its
   * in-flight `run` I/O.
   *
   * Two effects: (1) abort the per-fiber run signal so an in-flight
   * `run(fetch(url, { signal }))` stops promptly — harmless if the fiber
   * has no live controller; the next `runSignal()` makes a fresh one for
   * post-interrupt cleanup. (2) wake the fiber with a failure resume so
   * `stepIterator` delivers `it.throw(err)` at the next advance — the
   * fiber's own try/catch may catch and recover (interrupt is
   * swallowable / non-sticky). A done fiber is left untouched (`wake`
   * no-ops). Same machinery as the cancellation fan-out, scoped to one
   * fiber.
   *
   * Self-interrupt (a fiber interrupting its own task while advancing)
   * is uniform: the re-entrant `wake` fires during the fiber's own
   * step, and `advance` detects the epoch bump and delivers the throw at
   * the fiber's next yield rather than parking (see `advance`). If the
   * body returns before reaching another yield, the self-interrupt is
   * moot — there is no yield point to throw at.
   */
  interrupt(err: unknown): void {
    this.runController?.abort(err);
    this.wake({ ok: false, e: err });
    // Cascade down the spawn subtree: a task's interrupt also interrupts
    // every routine it spawned (transitively). Synchronous and in-memory,
    // issued from a fiber advance — same determinism as a single
    // interrupt. The walk doesn't mutate `children` (interrupt only
    // wakes; finish/prune happens later in a drain), so iterating is safe.
    for (const child of this.children) child.interrupt(err);
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
        // Snapshot the epoch around the step. A re-entrant `wake` during
        // user code (the fiber interrupting *itself* — the only way a
        // wake can target the fiber that is currently advancing) bumps
        // the epoch and installs a fresh resume in `this.state`. Stale
        // epoch-guarded waiters from a prior park return early without
        // waking, so they never bump it here — an epoch change across
        // the step means, unambiguously, a self-interrupt.
        const epochBefore = this.epoch;
        let next: IteratorResult<unknown, unknown>;
        try {
          next = stepIterator(this.it, resume, this.started);
        } catch (e) {
          this.finish({ ok: false, e });
          return;
        }
        this.started = true;
        if (next.done) {
          // The body returned before reaching another yield, so a
          // self-interrupt has no yield point to land on and is moot.
          this.finish({ ok: true, v: next.value });
          return;
        }

        // Self-interrupt during the step: deliver its resume at this
        // yield point instead of parking on the op the body just yielded.
        if (this.wokenDuringStep(epochBefore)) {
          resume = this.state.resume;
          continue;
        }

        const op = next.value as PrimitiveOp<unknown>;
        const node = op[opTag];
        // Each branch returns null to mean "I parked, the fiber is
        // suspended" or a Settled to mean "resume the iterator with
        // this value." Leaf and AwaitRace may or may not park
        // depending on whether their target is already settled.
        let outcome: Settled | null;
        switch (node._tag) {
          case "Leaf":
            outcome = this.parkOnLeaf(node);
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
      // Journal fires need no epoch guard (invariant I4): the scheduler
      // re-collects parked sources fresh each tick, so this source only
      // fires in the tick it was collected, before the fiber can move on.
      this.state = {
        kind: "parked",
        promises: [{ promise: backing.promise, fire: (s) => this.wake(s) }],
      };
      return null;
    }
    // Local-backed: ask the target (fiber, channel, …) for its settled
    // outcome (sync short-circuit) or register an epoch-guarded waiter —
    // the target never prunes it, so if we're interrupted and re-park it
    // must not wake the moved-on fiber.
    const settled = backing.target.awaitCompletion(
      this.epochGuarded((s) => this.wake(s))
    );
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
   * callback that wakes the fiber with `{index, settled}`. The epoch
   * guard ensures only the first source to settle wakes the fiber
   * (`wake` bumps the epoch, so any later same-tick fire sees a stale
   * epoch and no-ops) and that a waiter surviving an interrupt-and-
   * re-park can't fire onto the moved-on fiber. Local sources (fibers,
   * channels) park on the target's waiter list; journal sources race in
   * the main loop's race promise.
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

    const promises: PromiseSource[] = [];
    for (let i = 0; i < futures.length; i++) {
      const idx = i;
      const b = getBacking(futures[i]!);
      // Epoch-guarded so only the first source to settle wakes the fiber
      // (later same-tick fires see the bumped epoch and no-op), and a
      // loser surviving an interrupt-and-re-park can't fire onto it.
      const fireOnce = this.epochGuarded((settled) =>
        this.wake({ ok: true, v: { index: idx, settled } })
      );
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
    this.parent?.children.delete(this as Fiber<unknown>);
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
 *
 * `started` is whether the generator has run at least once. Throwing
 * into a *not-yet-started* generator propagates the error straight out
 * without executing any body code (its try/catch/finally never engage).
 * That happens when a spawned routine is interrupted before its first
 * advance. To honor the "delivered at the next yield point" /
 * swallowable contract, we prime the generator with one `next()` first,
 * so the throw lands at the body's first yield. If the body returns
 * before reaching a yield, there is no yield point and the throw is moot.
 */
function stepIterator(
  it: Iterator<unknown, unknown, unknown>,
  resume: Settled | null,
  started: boolean
): IteratorResult<unknown, unknown> {
  if (resume === null) return it.next(undefined);
  if (resume.ok) return it.next(resume.v);
  if (!started) {
    const first = it.next(undefined);
    if (first.done) return first;
  }
  if (it.throw) return it.throw(resume.e);
  throw resume.e;
}
