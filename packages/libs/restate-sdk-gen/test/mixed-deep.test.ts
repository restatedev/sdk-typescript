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

// Tests for deep combinator trees mixing journal-backed (ops.run-style)
// and routine-backed (spawn-style) Futures. The key shapes to exercise:
//
//   - all-of-races, race-of-alls, race-of-races, all-of-alls
//   - selecting on a future returned from another combinator
//   - spawning routines that themselves call combinators
//   - chains where one combinator's output feeds another's input
//
// These shapes show up in real workflows (e.g. "wait for any of three
// pipelines to complete, where each pipeline is itself a fan-out") and
// are where bugs in the dispatch path tend to hide.

import { describe, expect, test } from "vitest";
import {
  gen,
  select,
  spawn,
  type Future,
  type Operation,
} from "../src/index.js";
import { Scheduler } from "../src/internal.js";
import { deferred, resolved, testLib } from "./test-promise.js";

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

const makeJournal = <T>(sched: Scheduler, value: T): Future<T> =>
  sched.makeJournalFuture(resolved(value));

const makeDeferredJournal = <T>(sched: Scheduler) => {
  const d = deferred<T>();
  return {
    future: sched.makeJournalFuture(d.promise),
    resolve: d.resolve,
    reject: d.reject,
  };
};

// -----------------------------------------------------------------------------
// all nested inside all
// -----------------------------------------------------------------------------

describe("nested combinators — all of all", () => {
  test("two-level all-journal: outer all of inner all, all journal", async () => {
    const sched = new Scheduler(testLib);
    const op = gen(function* (): Generator<unknown, number[][], unknown> {
      const inner1 = sched.all([makeJournal(sched, 1), makeJournal(sched, 2)]);
      const inner2 = sched.all([makeJournal(sched, 3), makeJournal(sched, 4)]);
      const inner3 = sched.all([makeJournal(sched, 5), makeJournal(sched, 6)]);
      // The outer is all over journal-backed futures (because each inner
      // all returned a journal future via the fast path).
      return (yield* sched.all([inner1, inner2, inner3])) as number[][];
    });
    expect(await sched.run(op)).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
    ]);
  });

  test("two-level mixed: outer all where one inner is a spawn-join, others are journal", async () => {
    const sched = new Scheduler(testLib);
    const op = gen(function* (): Generator<unknown, number[][], unknown> {
      // Inner 1: pure journal all (fast path → journal future).
      const inner1 = sched.all([makeJournal(sched, 1), makeJournal(sched, 2)]);
      // Inner 2: spawn a routine that does its own all.
      const subOp: Operation<number[]> = gen(function* (): Generator<
        unknown,
        number[],
        unknown
      > {
        return (yield* sched.all([
          makeJournal(sched, 10),
          makeJournal(sched, 20),
        ])) as number[];
      });
      const inner2 = (yield* spawn(subOp)) as Future<number[]>;
      // Outer is over a journal future and a routine future — falls to the
      // synthesized join path.
      return (yield* sched.all([inner1, inner2])) as number[][];
    });
    expect(await sched.run(op)).toEqual([
      [1, 2],
      [10, 20],
    ]);
  });

  test("three levels deep: all over alls over alls", async () => {
    const sched = new Scheduler(testLib);
    const op = gen(function* (): Generator<unknown, number, unknown> {
      // 8 leaves, each a journal future. Group into pairs, then quads.
      const leaves = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => makeJournal(sched, n));
      const pairs = [
        sched.all([leaves[0]!, leaves[1]!]),
        sched.all([leaves[2]!, leaves[3]!]),
        sched.all([leaves[4]!, leaves[5]!]),
        sched.all([leaves[6]!, leaves[7]!]),
      ];
      const quads = [
        sched.all([pairs[0]!, pairs[1]!]),
        sched.all([pairs[2]!, pairs[3]!]),
      ];
      const all = (yield* sched.all(quads)) as number[][][];
      // Flatten and sum.
      let sum = 0;
      for (const q of all) for (const p of q) for (const n of p) sum += n;
      return sum;
    });
    expect(await sched.run(op)).toBe(36); // 1+2+...+8
  });
});

// -----------------------------------------------------------------------------
// race nested inside all and vice versa
// -----------------------------------------------------------------------------

describe("nested combinators — race inside all", () => {
  test("all of three races, each over [deferred, sync-resolved]", async () => {
    const sched = new Scheduler(testLib);
    const op = gen(function* (): Generator<unknown, string[], unknown> {
      const dSlow1 = makeDeferredJournal<string>(sched);
      const dSlow2 = makeDeferredJournal<string>(sched);
      const dSlow3 = makeDeferredJournal<string>(sched);
      const r1 = sched.race([dSlow1.future, makeJournal(sched, "fast1")]);
      const r2 = sched.race([dSlow2.future, makeJournal(sched, "fast2")]);
      const r3 = sched.race([dSlow3.future, makeJournal(sched, "fast3")]);
      // Resolve the deferreds too so all can drain them — but by that
      // time the races may have already settled, depending on
      // Promise.race's internal ordering with already-resolved vs newly-
      // resolving inputs.
      queueMicrotask(() => {
        dSlow1.resolve("late1");
        dSlow2.resolve("late2");
        dSlow3.resolve("late3");
      });
      return (yield* sched.all([r1, r2, r3])) as string[];
    });
    const result = await sched.run(op);
    // Each race picks one of {fastN, lateN}. Test that we get a valid
    // pair for each race; the actual winner is up to Promise.race.
    expect(result).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect([`fast${i + 1}`, `late${i + 1}`]).toContain(result[i]);
    }
  });

  test("all where some inputs are spawn(race(...)) chains", async () => {
    const sched = new Scheduler(testLib);
    const op = gen(function* (): Generator<unknown, string[], unknown> {
      // Each child does a race internally and returns the winner.
      const child = (label: string): Operation<string> =>
        gen(function* (): Generator<unknown, string, unknown> {
          const winner = (yield* sched.race([
            makeJournal(sched, `${label}-a`),
            makeJournal(sched, `${label}-b`),
          ])) as string;
          return winner;
        });
      const f1 = (yield* spawn(child("c1"))) as Future<string>;
      const f2 = (yield* spawn(child("c2"))) as Future<string>;
      const f3 = (yield* spawn(child("c3"))) as Future<string>;
      const out = (yield* sched.all([f1, f2, f3])) as string[];
      return out;
    });
    const result = await sched.run(op);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatch(/^c1-/);
    expect(result[1]).toMatch(/^c2-/);
    expect(result[2]).toMatch(/^c3-/);
  });
});

describe("nested combinators — all inside race", () => {
  test("race(all(slow), fast) returns fast", async () => {
    const sched = new Scheduler(testLib);
    const op = gen(function* (): Generator<unknown, unknown, unknown> {
      const dSlow1 = makeDeferredJournal<number>(sched);
      const dSlow2 = makeDeferredJournal<number>(sched);
      // all over deferred journal futures → a journal future that
      // settles when both deferreds resolve.
      const slowAll = sched.all([dSlow1.future, dSlow2.future]);
      const fast = makeJournal(sched, "winner");
      // Eventually drain the slow ones so the scheduler can finish.
      queueMicrotask(() => {
        queueMicrotask(() => {
          dSlow1.resolve(1);
          dSlow2.resolve(2);
        });
      });
      // The race is between a journal Future<number[]> and a journal
      // Future<string>. The new tuple-aware race types this as
      // `Future<number[] | string>` automatically — no widening needed.
      const winner = yield* sched.race([slowAll, fast]);
      return winner;
    });
    expect(await sched.run(op)).toBe("winner");
  });

  test("race over four all branches; one branch's all is sync-fast", async () => {
    const sched = new Scheduler(testLib);
    const op = gen(function* (): Generator<unknown, number[], unknown> {
      const fast = sched.all([makeJournal(sched, 1), makeJournal(sched, 2)]);
      const slow = (label: number) => {
        const d1 = makeDeferredJournal<number>(sched);
        const d2 = makeDeferredJournal<number>(sched);
        // Resolve eventually.
        queueMicrotask(() => {
          queueMicrotask(() => {
            d1.resolve(label);
            d2.resolve(label);
          });
        });
        return sched.all([d1.future, d2.future]);
      };
      const winner = (yield* sched.race([
        slow(10),
        slow(20),
        fast,
        slow(30),
      ])) as number[];
      return winner;
    });
    expect(await sched.run(op)).toEqual([1, 2]);
  });
});

// -----------------------------------------------------------------------------
// select nested with combinators
// -----------------------------------------------------------------------------

describe("nested combinators — select on combinator outputs", () => {
  test("select over (all, raw future): all-output as a branch", async () => {
    const sched = new Scheduler(testLib);
    const op = gen(function* (): Generator<unknown, string, unknown> {
      const both = sched.all([makeJournal(sched, 1), makeJournal(sched, 2)]);
      const direct = makeJournal(sched, "direct-wins");
      const r = yield* select({ both, direct });
      // Both are sync-ready; either may win. Whichever does, we identify it.
      switch (r.tag) {
        case "both": {
          const v = (yield* r.future) as number[];
          return `both:${v.join(",")}`;
        }
        case "direct":
          return `direct:${(yield* r.future) as string}`;
      }
    });
    const result = await sched.run(op);
    expect(["both:1,2", "direct:direct-wins"]).toContain(result);
  });

  test("select over multiple race-derived futures", async () => {
    const sched = new Scheduler(testLib);
    const op = gen(function* (): Generator<unknown, string, unknown> {
      const a = sched.race([
        makeJournal(sched, "a1"),
        makeJournal(sched, "a2"),
      ]);
      const b = sched.race([
        makeJournal(sched, "b1"),
        makeJournal(sched, "b2"),
      ]);
      const c = sched.race([
        makeJournal(sched, "c1"),
        makeJournal(sched, "c2"),
      ]);
      const r = yield* select({ a, b, c });
      const v = (yield* r.future) as string;
      return `${r.tag}:${v}`;
    });
    const result = await sched.run(op);
    expect(["a:", "b:", "c:"]).toContain(result.slice(0, 2));
    expect(result).toMatch(/^[abc]:[abc][12]$/);
  });
});

// -----------------------------------------------------------------------------
// Long pipelines
// -----------------------------------------------------------------------------

describe("nested combinators — long chains feeding into combinators", () => {
  test("pipeline: spawn → spawn → all → race", async () => {
    const sched = new Scheduler(testLib);
    const stage = (label: string, input: Future<number>): Operation<number> =>
      gen(function* (): Generator<unknown, number, unknown> {
        const v = (yield* input) as number;
        return v + label.length;
      });

    const op = gen(function* (): Generator<unknown, number, unknown> {
      const seed = makeJournal(sched, 0);
      // Two parallel pipelines, each two stages deep.
      const pipeA1 = (yield* spawn(stage("aa", seed))) as Future<number>;
      const pipeA2 = (yield* spawn(stage("aaa", pipeA1))) as Future<number>;
      const pipeB1 = (yield* spawn(stage("bbbb", seed))) as Future<number>;
      const pipeB2 = (yield* spawn(stage("bbbbb", pipeB1))) as Future<number>;
      // all over the two pipeline tails.
      const both = (yield* sched.all([pipeA2, pipeB2])) as number[];
      // 0 + 2 + 3 = 5,  0 + 4 + 5 = 9
      return both.reduce((a, b) => a + b, 0);
    });
    expect(await sched.run(op)).toBe(14);
  });

  test("recursive combinator tree of depth D, branching factor 2", async () => {
    const sched = new Scheduler(testLib);
    // Build a balanced binary tree of `all` calls over journal leaves; verify
    // the sum equals leaf count. Each non-leaf is a spawned routine that
    // sums its two children.
    const D = 6; // 64 leaves
    const buildTree = (depth: number): Future<number> => {
      if (depth === 0) return makeJournal(sched, 1);
      const left = buildTree(depth - 1);
      const right = buildTree(depth - 1);
      return sched.spawnDetached(
        gen(function* (): Generator<unknown, number, unknown> {
          const [a, b] = (yield* sched.all([left, right])) as number[];
          return (a as number) + (b as number);
        })
      );
    };
    const op = gen(function* (): Generator<unknown, number, unknown> {
      const tree = buildTree(D);
      return (yield* tree) as number;
    });
    // 2^D leaves of value 1.
    expect(await sched.run(op)).toBe(1 << D);
  });
});

// -----------------------------------------------------------------------------
// Routines spawning combinator-using routines
// -----------------------------------------------------------------------------

describe("nested combinators — routines that themselves use combinators", () => {
  test("worker pool: dispatcher spawns N workers, each does its own all", async () => {
    const sched = new Scheduler(testLib);
    const N = 5;
    const SUBTASKS = 3;

    const worker = (id: number): Operation<{ id: number; total: number }> =>
      gen(function* (): Generator<
        unknown,
        { id: number; total: number },
        unknown
      > {
        const subFutures: Future<number>[] = [];
        for (let i = 0; i < SUBTASKS; i++) {
          subFutures.push(makeJournal(sched, id * 100 + i));
        }
        const subResults = (yield* sched.all(subFutures)) as number[];
        return { id, total: subResults.reduce((a, b) => a + b, 0) };
      });

    const op = gen(function* (): Generator<
      unknown,
      Array<{ id: number; total: number }>,
      unknown
    > {
      const workerFutures: Future<{ id: number; total: number }>[] = [];
      for (let i = 0; i < N; i++) {
        workerFutures.push(
          (yield* spawn(worker(i))) as Future<{ id: number; total: number }>
        );
      }
      return (yield* sched.all(workerFutures)) as Array<{
        id: number;
        total: number;
      }>;
    });

    const results = await sched.run(op);
    expect(results).toHaveLength(N);
    for (let i = 0; i < N; i++) {
      const expected = i * 100 * SUBTASKS + (0 + 1 + 2);
      expect(results[i]).toEqual({ id: i, total: expected });
    }
  });

  test("hierarchical: top spawns mid spawns leaf, all use combinators", async () => {
    const sched = new Scheduler(testLib);

    const leaf = (n: number): Operation<number> =>
      gen(function* (): Generator<unknown, number, unknown> {
        const f1 = makeJournal(sched, n);
        const f2 = makeJournal(sched, n * 10);
        const winner = (yield* sched.race([f1, f2])) as number;
        return winner;
      });

    const mid = (label: number): Operation<number> =>
      gen(function* (): Generator<unknown, number, unknown> {
        const l1 = (yield* spawn(leaf(label))) as Future<number>;
        const l2 = (yield* spawn(leaf(label + 1))) as Future<number>;
        const both = (yield* sched.all([l1, l2])) as number[];
        return both.reduce((a, b) => a + b, 0);
      });

    const top = gen(function* (): Generator<unknown, number, unknown> {
      const m1 = (yield* spawn(mid(1))) as Future<number>;
      const m2 = (yield* spawn(mid(10))) as Future<number>;
      const m3 = (yield* spawn(mid(100))) as Future<number>;
      const all = (yield* sched.all([m1, m2, m3])) as number[];
      return all.reduce((a, b) => a + b, 0);
    });

    const result = await sched.run(top);
    // Each leaf returns either n or n*10. mid returns leaf(label) + leaf(label+1).
    // top returns mid(1) + mid(10) + mid(100). Bounds check:
    // min: 1+2 + 10+11 + 100+101 = 225
    // max: 10+20 + 100+110 + 1000+1010 = 2250
    expect(result).toBeGreaterThanOrEqual(225);
    expect(result).toBeLessThanOrEqual(2250);
  });
});

// -----------------------------------------------------------------------------
// Out-of-order resolution with deep mixed graphs
// -----------------------------------------------------------------------------

describe("nested combinators — out-of-order resolution", () => {
  test("deep all with mid-tree deferreds resolved in arbitrary order", async () => {
    const sched = new Scheduler(testLib);
    const N = 16;
    const ds = Array.from({ length: N }, () => deferred<number>());

    const op = gen(function* (): Generator<unknown, number, unknown> {
      const futures = ds.map((d) => sched.makeJournalFuture(d.promise));
      // Tree-shape: pair, then quad, then octet, then full.
      const buildLevel = (level: Future<number>[]): Future<number>[] => {
        const out: Future<number>[] = [];
        for (let i = 0; i < level.length; i += 2) {
          const a = level[i]!;
          const b = level[i + 1]!;
          out.push(
            sched.spawnDetached(
              gen(function* (): Generator<unknown, number, unknown> {
                const vs = (yield* sched.all([a, b])) as number[];
                return vs.reduce((x, y) => x + y, 0);
              })
            )
          );
        }
        return out;
      };
      let cur = futures;
      while (cur.length > 1) cur = buildLevel(cur);
      return (yield* cur[0]!) as number;
    });

    const result = sched.run(op);
    // Resolve in a scrambled order.
    const order = [7, 3, 11, 0, 15, 4, 8, 1, 12, 5, 9, 2, 14, 6, 10, 13];
    for (const i of order) ds[i]!.resolve(i);
    const sum = await result;
    expect(sum).toBe((N * (N - 1)) / 2);
  });

  test("racing routines that internally all deferreds, mixed resolution order", async () => {
    const sched = new Scheduler(testLib);
    const dA = [deferred<number>(), deferred<number>()];
    const dB = [deferred<number>(), deferred<number>()];

    const branchA: Operation<number> = gen(function* (): Generator<
      unknown,
      number,
      unknown
    > {
      const fs = dA.map((d) => sched.makeJournalFuture(d.promise));
      const vs = (yield* sched.all(fs)) as number[];
      return vs.reduce((a, b) => a + b, 0);
    });

    const branchB: Operation<number> = gen(function* (): Generator<
      unknown,
      number,
      unknown
    > {
      const fs = dB.map((d) => sched.makeJournalFuture(d.promise));
      const vs = (yield* sched.all(fs)) as number[];
      return vs.reduce((a, b) => a + b, 0);
    });

    const op = gen(function* (): Generator<unknown, number, unknown> {
      const fa = (yield* spawn(branchA)) as Future<number>;
      const fb = (yield* spawn(branchB)) as Future<number>;
      // Drain loser eventually so scheduler can complete.
      const winner = (yield* sched.race([fa, fb])) as number;
      return winner;
    });

    const result = sched.run(op);
    // Resolve A's first item, then B's first, then A's second (completes A),
    // then B's second (completes B). A should win.
    queueMicrotask(() => {
      dA[0]!.resolve(1);
      queueMicrotask(() => {
        dB[0]!.resolve(10);
        queueMicrotask(() => {
          dA[1]!.resolve(2);
          queueMicrotask(() => dB[1]!.resolve(20));
        });
      });
    });
    expect(await result).toBe(3);
  });
});
