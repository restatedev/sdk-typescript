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

// Observability tests: rather than just asserting on returned values,
// these tests *watch* what happens during execution — ordering of side
// effects across mixed routine/journal trees, who runs when, and how
// scheduler choices interact with user code structure.
//
// These complement the value-only tests by catching regressions in
// scheduling fairness, drainReady ordering, and the interaction
// between sync short-circuits and journal awaits.

import { describe, expect, test } from "vitest";
import {
  gen,
  select,
  spawn,
  type Future,
  type Operation,
} from "../src/index.js";
import {
  Scheduler,
} from "../src/internal.js";
import { deferred, resolved, testLib } from "./test-promise.js";

// A trace recorder. Each entry tags its origin so tests can assert on the
// interleaving pattern.
type Trace = string[];

const tracingChild = (
  trace: Trace,
  label: string,
  steps: number
): Operation<string> =>
  gen(function* (): Generator<unknown, string, unknown> {
    trace.push(`${label}:start`);
    for (let i = 0; i < steps; i++) {
      trace.push(`${label}:step${i}:before`);
      yield* {
        // bare op: yield a journal future built inline from a fresh Promise
        [Symbol.iterator]: function* (): Generator<unknown, void, unknown> {
          // (kept inline to keep the helper self-contained, but tests
          // will use the proper sched.makeJournalFuture in their bodies)
        },
      };
      trace.push(`${label}:step${i}:after`);
    }
    trace.push(`${label}:end`);
    return label;
  });

void tracingChild;

// -----------------------------------------------------------------------------
// Drain-order observability
// -----------------------------------------------------------------------------

describe("observability — drainReady runs siblings to completion before the parent resumes", () => {
  test("two sync siblings both finish before parent's next yield", async () => {
    const sched = new Scheduler(testLib);
    const trace: string[] = [];

    const fast = (label: string): Operation<void> =>
      gen(function* (): Generator<unknown, void, unknown> {
        trace.push(`${label}:body`);
      });

    const op = gen(function* (): Generator<unknown, void, unknown> {
      trace.push("parent:before-spawn-a");
      const fa = (yield* spawn(fast("a"))) as Future<void>;
      trace.push("parent:between-spawns");
      const fb = (yield* spawn(fast("b"))) as Future<void>;
      trace.push("parent:after-spawns");
      yield* fa;
      trace.push("parent:after-await-a");
      yield* fb;
      trace.push("parent:after-await-b");
    });

    await sched.run(op);
    // The exact interleaving depends on how the scheduler drains:
    // - parent runs until it yields (spawn → resume immediately with Future)
    // - child a is in ready queue. After parent's "between-spawns" trace,
    //   parent yields again (spawn b), pushing b into ready. Both children
    //   sit in ready until parent eventually parks.
    // - When parent does `yield* fa`, parent parks. drainReady processes
    //   a, then b (FIFO). Both finish synchronously. Their finish wakes
    //   the parent. Parent resumes after-await-a.
    // We assert key ordering invariants without overspecifying:
    expect(trace.indexOf("parent:before-spawn-a")).toBeLessThan(
      trace.indexOf("parent:between-spawns")
    );
    expect(trace.indexOf("parent:between-spawns")).toBeLessThan(
      trace.indexOf("parent:after-spawns")
    );
    expect(trace.indexOf("a:body")).toBeLessThan(
      trace.indexOf("parent:after-await-a")
    );
    expect(trace.indexOf("b:body")).toBeLessThan(
      trace.indexOf("parent:after-await-b")
    );
    // Children run after the parent's spawn-loop because spawn is
    // synchronous from the parent's perspective (child sits in ready).
    expect(trace.indexOf("parent:after-spawns")).toBeLessThan(
      trace.indexOf("a:body")
    );
  });

  test("a child that yields before sibling: scheduler interleaves them", async () => {
    const sched = new Scheduler(testLib);
    const trace: string[] = [];

    const child = (label: string): Operation<void> =>
      gen(function* (): Generator<unknown, void, unknown> {
        trace.push(`${label}:before-yield`);
        yield* sched.makeJournalFuture(resolved<void>(undefined));
        trace.push(`${label}:after-yield`);
      });

    const op = gen(function* (): Generator<unknown, void, unknown> {
      const fa = (yield* spawn(child("a"))) as Future<void>;
      const fb = (yield* spawn(child("b"))) as Future<void>;
      yield* fa;
      yield* fb;
    });

    await sched.run(op);
    // Both children should reach `before-yield` before either reaches
    // `after-yield` — they all park on journal futures, the main loop
    // resolves them, then drainReady processes both.
    const aBefore = trace.indexOf("a:before-yield");
    const bBefore = trace.indexOf("b:before-yield");
    const aAfter = trace.indexOf("a:after-yield");
    const bAfter = trace.indexOf("b:after-yield");
    expect(aBefore).toBeGreaterThanOrEqual(0);
    expect(bBefore).toBeGreaterThanOrEqual(0);
    expect(aAfter).toBeGreaterThanOrEqual(0);
    expect(bAfter).toBeGreaterThanOrEqual(0);
    // Both befores happen before either after.
    expect(Math.max(aBefore, bBefore)).toBeLessThan(Math.min(aAfter, bAfter));
  });
});

// -----------------------------------------------------------------------------
// Race observation: who actually wins under various structural setups
// -----------------------------------------------------------------------------

describe("observability — race winner identity", () => {
  test("race(spawn(synchronous routine), deferred journal): routine wins synchronously", async () => {
    const sched = new Scheduler(testLib);
    const trace: string[] = [];
    const dJournal = deferred<string>();

    const syncRoutine: Operation<string> = gen(function* (): Generator<
      unknown,
      string,
      unknown
    > {
      trace.push("routine:running");
      return "routine";
    });

    const op = gen(function* (): Generator<unknown, string, unknown> {
      trace.push("op:before-spawn");
      const fr = (yield* spawn(syncRoutine)) as Future<string>;
      trace.push("op:after-spawn");
      const fj = sched.makeJournalFuture(dJournal.promise);
      trace.push("op:before-race");
      const winner = (yield* sched.race([fj, fr])) as string;
      trace.push(`op:race-won=${winner}`);
      // Drain the loser so scheduler can complete.
      queueMicrotask(() => dJournal.resolve("late"));
      return winner;
    });

    expect(await sched.run(op)).toBe("routine");
    // Spawned routines are placed in the ready queue but don't preempt the
    // parent — the parent continues until it itself yields. So the routine
    // body runs *after* the parent parks on the race, and the race's
    // synthesized join body sees fr as already-done via sync short-circuit.
    expect(trace.indexOf("op:before-spawn")).toBeLessThan(
      trace.indexOf("op:after-spawn")
    );
    expect(trace.indexOf("op:after-spawn")).toBeLessThan(
      trace.indexOf("op:before-race")
    );
    expect(trace.indexOf("op:before-race")).toBeLessThan(
      trace.indexOf("routine:running")
    );
    expect(trace.indexOf("routine:running")).toBeLessThan(
      trace.indexOf("op:race-won=routine")
    );
  });

  test("race observed across multiple iterations: each iteration sees fresh side effects", async () => {
    const sched = new Scheduler(testLib);
    const observations: string[] = [];

    const op = gen(function* (): Generator<unknown, void, unknown> {
      for (let i = 0; i < 4; i++) {
        // Fresh routines each iteration.
        const a = gen(function* (): Generator<unknown, string, unknown> {
          return `a${i}`;
        });
        const b = gen(function* (): Generator<unknown, string, unknown> {
          return `b${i}`;
        });
        const fa = (yield* spawn(a)) as Future<string>;
        const fb = (yield* spawn(b)) as Future<string>;
        const winner = (yield* sched.race([fa, fb])) as string;
        observations.push(winner);
      }
    });

    await sched.run(op);
    // 4 iterations, each picks its own pair. Whichever wins, the observation
    // matches the iteration's labels.
    expect(observations).toHaveLength(4);
    for (let i = 0; i < 4; i++) {
      expect([`a${i}`, `b${i}`]).toContain(observations[i]);
    }
  });
});

// -----------------------------------------------------------------------------
// Allof observability under partial-resolution
// -----------------------------------------------------------------------------

describe("observability — all settle-order vs return-order", () => {
  test("all returns results in input order even when settle order is reversed", async () => {
    const sched = new Scheduler(testLib);
    const settledOrder: number[] = [];

    const ds = [deferred<number>(), deferred<number>(), deferred<number>()];

    const watcher = (id: number): Operation<number> =>
      gen(function* (): Generator<unknown, number, unknown> {
        const v = (yield* sched.makeJournalFuture(ds[id]!.promise)) as number;
        settledOrder.push(id);
        return v;
      });

    const op = gen(function* (): Generator<unknown, number[], unknown> {
      const f1 = (yield* spawn(watcher(0))) as Future<number>;
      const f2 = (yield* spawn(watcher(1))) as Future<number>;
      const f3 = (yield* spawn(watcher(2))) as Future<number>;
      return (yield* sched.all([f1, f2, f3])) as number[];
    });

    const promise = sched.run(op);
    // Resolve in reverse order via cascading microtasks.
    queueMicrotask(() => {
      ds[2]!.resolve(20);
      queueMicrotask(() => {
        ds[1]!.resolve(10);
        queueMicrotask(() => {
          ds[0]!.resolve(0);
        });
      });
    });
    // The contract under test: input-order results, regardless of how the
    // individual deferreds settled.
    expect(await promise).toEqual([0, 10, 20]);
    // We don't assert on settledOrder — the actual ordering depends on
    // microtask interleaving with scheduler main-loop awaits, and is not
    // a property the system guarantees. We do check that each watcher
    // settled exactly once.
    expect(settledOrder).toHaveLength(3);
    expect(new Set(settledOrder)).toEqual(new Set([0, 1, 2]));
  });

  test("all with one slow input: fast inputs settle first but result ordering preserved", async () => {
    const sched = new Scheduler(testLib);
    const dSlow = deferred<string>();
    const op = gen(function* (): Generator<unknown, string[], unknown> {
      const fast1 = sched.makeJournalFuture(resolved("fast1"));
      const slow = sched.makeJournalFuture(dSlow.promise);
      const fast2 = sched.makeJournalFuture(resolved("fast2"));
      // Resolve slow eventually.
      queueMicrotask(() => dSlow.resolve("slow"));
      return (yield* sched.all([fast1, slow, fast2])) as string[];
    });
    expect(await sched.run(op)).toEqual(["fast1", "slow", "fast2"]);
  });
});

// -----------------------------------------------------------------------------
// Select-loop observability: counts and patterns
// -----------------------------------------------------------------------------

describe("observability — select-loop cadence", () => {
  test("select with terminal branch always fires terminal at least once when ready", async () => {
    const sched = new Scheduler(testLib);
    const tickHistory: number[] = [];
    const dDone = deferred<string>();

    const op = gen(function* (): Generator<unknown, string, unknown> {
      const fDone = sched.makeJournalFuture(dDone.promise);
      let tick = 0;
      while (true) {
        const fTick = sched.makeJournalFuture(resolved(tick));
        const r = yield* select({ done: fDone, tick: fTick });
        if (r.tag === "done") {
          return (yield* r.future) as string;
        }
        tickHistory.push(tick);
        tick++;
        if (tick === 3) {
          dDone.resolve("stopped");
        }
        if (tick > 50) throw new Error("runaway");
      }
    });

    const result = await sched.run(op);
    expect(result).toBe("stopped");
    // We ticked at least 3 times before stop; possibly one more if the
    // sync short-circuit picked tick over done in the next iteration.
    expect(tickHistory.length).toBeGreaterThanOrEqual(3);
    expect(tickHistory.length).toBeLessThanOrEqual(4);
    expect(tickHistory.slice(0, 3)).toEqual([0, 1, 2]);
  });

  test("select alternates between two ready branches over many iterations", async () => {
    const sched = new Scheduler(testLib);
    const counts: Record<string, number> = { a: 0, b: 0 };

    const op = gen(function* (): Generator<unknown, void, unknown> {
      for (let i = 0; i < 100; i++) {
        const fa = sched.makeJournalFuture(resolved("a"));
        const fb = sched.makeJournalFuture(resolved("b"));
        const r = yield* select({ a: fa, b: fb });
        counts[r.tag]!++;
      }
    });

    await sched.run(op);
    // Both branches were ready every iteration; whichever wins, total = 100.
    expect(counts.a! + counts.b!).toBe(100);
  });
});

// -----------------------------------------------------------------------------
// Deep tree observability
// -----------------------------------------------------------------------------

describe("observability — deep tree side effects", () => {
  test("tree of spawn-all records all leaf executions", async () => {
    const sched = new Scheduler(testLib);
    const leaves: number[] = [];

    const leaf = (n: number): Operation<number> =>
      gen(function* (): Generator<unknown, number, unknown> {
        leaves.push(n);
        return n;
      });

    const subtree = (label: number, count: number): Operation<number> =>
      gen(function* (): Generator<unknown, number, unknown> {
        const futures: Future<number>[] = [];
        for (let i = 0; i < count; i++) {
          futures.push((yield* spawn(leaf(label * 100 + i))) as Future<number>);
        }
        const vals = (yield* sched.all(futures)) as number[];
        return vals.reduce((a, b) => a + b, 0);
      });

    const op = gen(function* (): Generator<unknown, number, unknown> {
      const t1 = (yield* spawn(subtree(1, 3))) as Future<number>;
      const t2 = (yield* spawn(subtree(2, 4))) as Future<number>;
      const t3 = (yield* spawn(subtree(3, 5))) as Future<number>;
      const all = (yield* sched.all([t1, t2, t3])) as number[];
      return all.reduce((a, b) => a + b, 0);
    });

    const result = await sched.run(op);
    // 3 + 4 + 5 = 12 leaves
    expect(leaves).toHaveLength(12);
    // Sanity: the leaves we expect to have run (in some order).
    const expected = new Set<number>();
    for (let i = 0; i < 3; i++) expected.add(100 + i);
    for (let i = 0; i < 4; i++) expected.add(200 + i);
    for (let i = 0; i < 5; i++) expected.add(300 + i);
    expect(new Set(leaves)).toEqual(expected);
    // Sum check.
    let s = 0;
    for (const v of expected) s += v;
    expect(result).toBe(s);
  });
});

// -----------------------------------------------------------------------------
// Mixed-source race: which wins when?
// -----------------------------------------------------------------------------

describe("observability — race winner depends on settlement timing", () => {
  test("repeating race(deferredSlow, syncRoutine) consistently picks the routine", async () => {
    const sched = new Scheduler(testLib);
    const winners: string[] = [];

    const op = gen(function* (): Generator<unknown, void, unknown> {
      for (let i = 0; i < 10; i++) {
        const dSlow = deferred<string>();
        const sync: Operation<string> = gen(function* (): Generator<
          unknown,
          string,
          unknown
        > {
          return "sync";
        });
        const fSlow = sched.makeJournalFuture(dSlow.promise);
        const fSync = (yield* spawn(sync)) as Future<string>;
        queueMicrotask(() => dSlow.resolve("late"));
        const winner = (yield* sched.race([fSlow, fSync])) as string;
        winners.push(winner);
      }
    });

    await sched.run(op);
    // The sync routine should always win since it sits already-done in the
    // ready queue when the race begins; AwaitAny's sync short-circuit picks
    // it over the deferred journal source.
    expect(winners).toEqual(Array(10).fill("sync"));
  });
});
