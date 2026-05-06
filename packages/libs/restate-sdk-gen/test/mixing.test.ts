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

// Mixing tests: heavy interleaving of journal futures and spawned
// routines, deep nested combinator trees, futures handed across spawn
// boundaries, combinators of combinators of combinators.
//
// Real workflows rarely use a single primitive in isolation. They build
// trees of all/race/select with both journal-backed and routine-backed
// inputs, pass futures into spawned subtasks, await-then-rerace, etc.
// Bugs that survive flat tests show up here.

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

describe("mixing — flat journal+routine inputs", () => {
  test("all over alternating journal/routine sources, all in input order", async () => {
    const sched = new Scheduler(testLib);
    const tag = (label: string): Operation<string> =>
      gen(function* (): Generator<unknown, string, unknown> {
        yield* sched.makeJournalFuture(resolved<void>(undefined));
        return label;
      });
    const op = gen(function* (): Generator<unknown, string[], unknown> {
      const j1 = sched.makeJournalFuture(resolved("j1"));
      const r1 = (yield* spawn(tag("r1"))) as Future<string>;
      const j2 = sched.makeJournalFuture(resolved("j2"));
      const r2 = (yield* spawn(tag("r2"))) as Future<string>;
      const j3 = sched.makeJournalFuture(resolved("j3"));
      return (yield* sched.all([j1, r1, j2, r2, j3])) as string[];
    });
    expect(await sched.run(op)).toEqual(["j1", "r1", "j2", "r2", "j3"]);
  });

  test("race over alternating sources where a routine wins", async () => {
    const sched = new Scheduler(testLib);
    const dJ1 = deferred<string>();
    const dJ2 = deferred<string>();
    const fastRoutine: Operation<string> = gen(function* (): Generator<
      unknown,
      string,
      unknown
    > {
      return "routine-wins";
    });
    const op = gen(function* (): Generator<unknown, string, unknown> {
      const j1 = sched.makeJournalFuture(dJ1.promise);
      const r1 = (yield* spawn(fastRoutine)) as Future<string>;
      const j2 = sched.makeJournalFuture(dJ2.promise);
      const winner = (yield* sched.race([j1, r1, j2])) as string;
      // Drain losers.
      queueMicrotask(() => {
        dJ1.resolve("late-j1");
        dJ2.resolve("late-j2");
      });
      return winner;
    });
    expect(await sched.run(op)).toBe("routine-wins");
  });

  test("race where a slow routine and slow journal both lose to a fast journal", async () => {
    const sched = new Scheduler(testLib);
    const dRoutine = deferred<string>();
    const dJournal = deferred<string>();
    const slow: Operation<string> = gen(function* (): Generator<
      unknown,
      string,
      unknown
    > {
      return (yield* sched.makeJournalFuture(dRoutine.promise)) as string;
    });
    const op = gen(function* (): Generator<unknown, string, unknown> {
      const fr = (yield* spawn(slow)) as Future<string>;
      const fjSlow = sched.makeJournalFuture(dJournal.promise);
      const fjFast = sched.makeJournalFuture(resolved("fast"));
      const winner = (yield* sched.race([fr, fjSlow, fjFast])) as string;
      queueMicrotask(() => {
        dRoutine.resolve("late-routine");
        dJournal.resolve("late-journal");
      });
      return winner;
    });
    expect(await sched.run(op)).toBe("fast");
  });
});

describe("mixing — futures handed across spawn boundaries", () => {
  test("parent creates a journal future, hands it to a child routine, awaits the child", async () => {
    const sched = new Scheduler(testLib);
    const d = deferred<number>();

    const consumer = (input: Future<number>): Operation<number> =>
      gen(function* (): Generator<unknown, number, unknown> {
        const v = (yield* input) as number;
        return v * 10;
      });

    const op = gen(function* (): Generator<unknown, number, unknown> {
      const f = sched.makeJournalFuture(d.promise);
      const fc = (yield* spawn(consumer(f))) as Future<number>;
      queueMicrotask(() => d.resolve(7));
      return (yield* fc) as number;
    });

    expect(await sched.run(op)).toBe(70);
  });

  test("multiple children all reading the same parent-owned journal future", async () => {
    const sched = new Scheduler(testLib);
    const d = deferred<number>();

    const reader = (id: number, input: Future<number>): Operation<string> =>
      gen(function* (): Generator<unknown, string, unknown> {
        const v = (yield* input) as number;
        return `${id}=${v}`;
      });

    const op = gen(function* (): Generator<unknown, string[], unknown> {
      const f = sched.makeJournalFuture(d.promise);
      const fr1 = (yield* spawn(reader(1, f))) as Future<string>;
      const fr2 = (yield* spawn(reader(2, f))) as Future<string>;
      const fr3 = (yield* spawn(reader(3, f))) as Future<string>;
      queueMicrotask(() => d.resolve(99));
      return (yield* sched.all([fr1, fr2, fr3])) as string[];
    });

    expect(await sched.run(op)).toEqual(["1=99", "2=99", "3=99"]);
  });

  test("child returns a journal future to its parent", async () => {
    const sched = new Scheduler(testLib);
    const d = deferred<string>();

    const producer: Operation<Future<string>> = gen(function* (): Generator<
      unknown,
      Future<string>,
      unknown
    > {
      // Some "preparation" yield.
      yield* sched.makeJournalFuture(resolved<void>(undefined));
      // Hand back a future the parent can await later.
      return sched.makeJournalFuture(d.promise);
    });

    const op = gen(function* (): Generator<unknown, string, unknown> {
      const fp = (yield* spawn(producer)) as Future<Future<string>>;
      // Get the inner future from the producer.
      const inner = (yield* fp) as Future<string>;
      // Now actually wait on the inner future.
      queueMicrotask(() => d.resolve("delivered"));
      return (yield* inner) as string;
    });

    expect(await sched.run(op)).toBe("delivered");
  });

  test("child returns a routine-backed future via re-spawn", async () => {
    const sched = new Scheduler(testLib);

    const inner: Operation<number> = gen(function* (): Generator<
      unknown,
      number,
      unknown
    > {
      return 42;
    });

    const outer: Operation<Future<number>> = gen(function* (): Generator<
      unknown,
      Future<number>,
      unknown
    > {
      // Spawn inner inside outer; return its future.
      return (yield* spawn(inner)) as Future<number>;
    });

    const op = gen(function* (): Generator<unknown, number, unknown> {
      const fo = (yield* spawn(outer)) as Future<Future<number>>;
      const fi = (yield* fo) as Future<number>;
      return (yield* fi) as number;
    });

    expect(await sched.run(op)).toBe(42);
  });
});

describe("mixing — combinators of combinators", () => {
  test("all of races", async () => {
    const sched = new Scheduler(testLib);
    const op = gen(function* (): Generator<unknown, string[], unknown> {
      // Build three "race winners" — each race resolves to one of its inputs.
      const r1 = sched.race([
        sched.makeJournalFuture(resolved("a1")),
        sched.makeJournalFuture(resolved("a2")),
      ]);
      const r2 = sched.race([
        sched.makeJournalFuture(resolved("b1")),
        sched.makeJournalFuture(resolved("b2")),
      ]);
      const r3 = sched.race([
        sched.makeJournalFuture(resolved("c1")),
        sched.makeJournalFuture(resolved("c2")),
      ]);
      return (yield* sched.all([r1, r2, r3])) as string[];
    });
    const result = await sched.run(op);
    expect(result).toHaveLength(3);
    expect(["a1", "a2"]).toContain(result[0]);
    expect(["b1", "b2"]).toContain(result[1]);
    expect(["c1", "c2"]).toContain(result[2]);
  });

  test("race of `all`s", async () => {
    const sched = new Scheduler(testLib);
    const dGroup1 = deferred<string>();
    const dGroup2 = deferred<string>();
    const op = gen(function* (): Generator<unknown, string[], unknown> {
      // Group 1: blocks on dGroup1.
      const g1 = sched.all([
        sched.makeJournalFuture(resolved("g1a")),
        sched.makeJournalFuture(dGroup1.promise),
      ]);
      // Group 2: blocks on dGroup2.
      const g2 = sched.all([
        sched.makeJournalFuture(resolved("g2a")),
        sched.makeJournalFuture(dGroup2.promise),
      ]);
      // Race: whichever group completes first wins.
      const winner = (yield* sched.race([g1, g2])) as string[];
      queueMicrotask(() => {
        dGroup1.resolve("g1-late");
        dGroup2.resolve("g2-late");
      });
      return winner;
    });
    const result = sched.run(op);
    queueMicrotask(() => dGroup1.resolve("g1b"));
    expect(await result).toEqual(["g1a", "g1b"]);
  });

  test("nested race-of-race-of-race", async () => {
    const sched = new Scheduler(testLib);
    const op = gen(function* (): Generator<unknown, string, unknown> {
      const inner = sched.race([
        sched.makeJournalFuture(resolved("inner-a")),
        sched.makeJournalFuture(resolved("inner-b")),
      ]);
      const middle = sched.race([
        inner,
        sched.makeJournalFuture(resolved("middle-c")),
      ]);
      const outer = sched.race([
        middle,
        sched.makeJournalFuture(resolved("outer-d")),
      ]);
      return (yield* outer) as string;
    });
    const result = await sched.run(op);
    expect(["inner-a", "inner-b", "middle-c", "outer-d"]).toContain(result);
  });

  test("all of `all`s (matrix-shaped)", async () => {
    const sched = new Scheduler(testLib);
    const op = gen(function* (): Generator<unknown, number[][], unknown> {
      // 3x3 matrix of journal futures; all rows, then all the row-`all`s.
      const rows: Future<number[]>[] = [];
      for (let i = 0; i < 3; i++) {
        const row: Future<number>[] = [];
        for (let j = 0; j < 3; j++) {
          row.push(sched.makeJournalFuture(resolved(i * 3 + j)));
        }
        rows.push(sched.all(row));
      }
      return (yield* sched.all(rows)) as number[][];
    });
    expect(await sched.run(op)).toEqual([
      [0, 1, 2],
      [3, 4, 5],
      [6, 7, 8],
    ]);
  });
});

describe("mixing — select inside spawned routines", () => {
  test("multiple spawned routines, each running a select loop", async () => {
    const sched = new Scheduler(testLib);
    const stops = [deferred<void>(), deferred<void>(), deferred<void>()];
    const counts: number[] = [0, 0, 0];

    const worker = (id: number): Operation<number> =>
      gen(function* (): Generator<unknown, number, unknown> {
        const fStop = sched.makeJournalFuture(stops[id]!.promise);
        while (true) {
          const fTick = sched.makeJournalFuture(resolved<void>(undefined));
          const r = yield* select({ stop: fStop, tick: fTick });
          if (r.tag === "stop") return counts[id]!;
          counts[id]!++;
          if (counts[id]! >= 3 + id) {
            // Each worker stops at a different count.
            stops[id]!.resolve();
          }
          if (counts[id]! > 100) throw new Error("runaway");
        }
      });

    const op = gen(function* (): Generator<unknown, number[], unknown> {
      const futures: Future<number>[] = [];
      for (let i = 0; i < 3; i++) {
        futures.push((yield* spawn(worker(i))) as Future<number>);
      }
      return (yield* sched.all(futures)) as number[];
    });

    const results = await sched.run(op);
    // Each worker stops at id+3 to id+4 ticks (the ±1 race window from
    // sync short-circuits).
    expect(results).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect([3 + i, 4 + i]).toContain(results[i]);
    }
  });

  test("parent and children both running selects against the same shared signal", async () => {
    const sched = new Scheduler(testLib);
    const dDone = deferred<string>();

    const observer = (id: number): Operation<string> =>
      gen(function* (): Generator<unknown, string, unknown> {
        const fDone = sched.makeJournalFuture(dDone.promise);
        const fOther = sched.makeJournalFuture(resolved("noop"));
        const r = yield* select({ done: fDone, other: fOther });
        // We don't care which won — just record what we saw.
        return `o${id}:${r.tag}`;
      });

    const op = gen(function* (): Generator<unknown, string, unknown> {
      const f1 = (yield* spawn(observer(1))) as Future<string>;
      const f2 = (yield* spawn(observer(2))) as Future<string>;
      const fDone = sched.makeJournalFuture(dDone.promise);
      const fOther = sched.makeJournalFuture(resolved("parent-noop"));
      // Resolve done so any observer that hasn't seen "other" win sees "done".
      queueMicrotask(() => dDone.resolve("payload"));
      const r = yield* select({ done: fDone, other: fOther });
      const r1 = (yield* f1) as string;
      const r2 = (yield* f2) as string;
      return `parent:${r.tag} ${r1} ${r2}`;
    });

    const result = await sched.run(op);
    expect(result).toMatch(
      /^parent:(done|other) o1:(done|other) o2:(done|other)$/
    );
  });
});

describe("mixing — deep trees of spawn+combine", () => {
  test("balanced binary tree of all, depth 5, each leaf a journal future", async () => {
    const sched = new Scheduler(testLib);
    let leafCount = 0;

    // Tree: each non-leaf is all of two children. Depth 5 means 32 leaves.
    const node = (depth: number): Future<number> => {
      if (depth === 0) {
        const id = leafCount++;
        return sched.makeJournalFuture(resolved(id));
      }
      const left = node(depth - 1);
      const right = node(depth - 1);
      return sched.spawnDetached(
        gen(function* (): Generator<unknown, number, unknown> {
          const [a, b] = (yield* sched.all([left, right])) as number[];
          return (a as number) + (b as number);
        })
      );
    };

    const root = node(5);
    const op = gen(function* (): Generator<unknown, number, unknown> {
      return (yield* root) as number;
    });
    // Sum of 0..31 = 496.
    expect(await sched.run(op)).toBe(496);
  });

  test("balanced ternary tree of races, depth 3, 27 leaves", async () => {
    const sched = new Scheduler(testLib);
    let leafCount = 0;

    const node = (depth: number): Future<number> => {
      if (depth === 0) {
        return sched.makeJournalFuture(resolved(leafCount++));
      }
      const children: Future<number>[] = [
        node(depth - 1),
        node(depth - 1),
        node(depth - 1),
      ];
      return sched.race(children);
    };

    const root = node(3);
    const op = gen(function* (): Generator<unknown, number, unknown> {
      return (yield* root) as number;
    });
    const result = await sched.run(op);
    // The root is a race over 3 races over 3 races over 3 leaves = 27 leaves.
    // Whichever wins, the value is in [0, 27).
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThan(27);
  });

  test("alternating all/race tree (depth 4), each node spawns its body", async () => {
    const sched = new Scheduler(testLib);

    type Mode = "all" | "race";
    const node = (depth: number, mode: Mode, label: number): Future<number> => {
      if (depth === 0) {
        return sched.makeJournalFuture(resolved(label));
      }
      const childMode: Mode = mode === "all" ? "race" : "all";
      const children = [
        node(depth - 1, childMode, label * 10 + 1),
        node(depth - 1, childMode, label * 10 + 2),
      ];
      return sched.spawnDetached(
        gen(function* (): Generator<unknown, number, unknown> {
          if (mode === "all") {
            const xs = (yield* sched.all(children)) as number[];
            return xs.reduce((a, b) => a + b, 0);
          } else {
            return (yield* sched.race(children)) as number;
          }
        })
      );
    };

    const root = node(4, "all", 1);
    const op = gen(function* (): Generator<unknown, number, unknown> {
      return (yield* root) as number;
    });
    // Just ensure it completes without crashing or timing out.
    const result = await sched.run(op);
    expect(typeof result).toBe("number");
  });

  test("deep spawn chain (parent spawns child spawns grandchild ...)", async () => {
    const sched = new Scheduler(testLib);
    const D = 50;

    const chain = (n: number): Operation<number> =>
      gen(function* (): Generator<unknown, number, unknown> {
        if (n === 0) return 0;
        const f = (yield* spawn(chain(n - 1))) as Future<number>;
        const v = (yield* f) as number;
        return v + 1;
      });

    expect(await sched.run(chain(D))).toBe(D);
  });
});

describe("mixing — re-yielding the same future in different contexts", () => {
  test("the same journal future awaited directly and inside an all", async () => {
    const sched = new Scheduler(testLib);
    const d = deferred<number>();
    const op = gen(function* (): Generator<unknown, number, unknown> {
      const f = sched.makeJournalFuture(d.promise);
      // First context: direct yield. Resolves once d resolves.
      // Second context: inside all with another future. Same f, awaited again.
      queueMicrotask(() => d.resolve(7));
      const v1 = (yield* f) as number;
      const both = (yield* sched.all([
        f,
        sched.makeJournalFuture(resolved(100)),
      ])) as number[];
      return v1 + both.reduce((a, b) => a + b, 0);
    });
    // 7 + 7 + 100 = 114.
    expect(await sched.run(op)).toBe(114);
  });

  test("the same routine-backed future awaited multiple times", async () => {
    const sched = new Scheduler(testLib);
    const child: Operation<number> = gen(function* (): Generator<
      unknown,
      number,
      unknown
    > {
      return 5;
    });
    const op = gen(function* (): Generator<unknown, number, unknown> {
      const f = (yield* spawn(child)) as Future<number>;
      const a = (yield* f) as number;
      const b = (yield* f) as number;
      const c = (yield* f) as number;
      return a + b + c;
    });
    expect(await sched.run(op)).toBe(15);
  });
});
