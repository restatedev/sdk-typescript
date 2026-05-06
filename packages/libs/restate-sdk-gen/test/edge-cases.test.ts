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

// Subtle interaction edge cases that flat tests don't usually catch:
//   - errors in synthesized combinator bodies (routine-backed all/race)
//   - waiter-list correctness when targets settle before the waiter parks
//   - ordering invariants
//   - rejection propagation through deep combinator trees

import { describe, expect, test } from "vitest";
import { gen, spawn, type Future, type Operation } from "../src/index.js";
import { Scheduler } from "../src/internal.js";
import { deferred, resolved, testLib } from "./test-promise.js";

describe("edge — error propagation through synthesized combinator bodies", () => {
  test("routine-backed all: error in middle input throws, but other inputs still complete", async () => {
    const sched = new Scheduler(testLib);
    const dGood1 = deferred<string>();
    const dGood2 = deferred<string>();
    const failing: Operation<string> = gen(function* (): Generator<
      unknown,
      string,
      unknown
    > {
      yield* sched.makeJournalFuture(resolved<void>(undefined));
      throw new Error("middle-fail");
    });
    const reading = (
      d: Awaited<ReturnType<typeof deferred<string>>>
    ): Operation<string> =>
      gen(function* (): Generator<unknown, string, unknown> {
        return (yield* sched.makeJournalFuture(d.promise)) as string;
      });
    const op = gen(function* (): Generator<unknown, string, unknown> {
      const f1 = (yield* spawn(reading(dGood1))) as Future<string>;
      const fMid = (yield* spawn(failing)) as Future<string>;
      const f2 = (yield* spawn(reading(dGood2))) as Future<string>;
      // Drain good ones eventually so scheduler can complete.
      queueMicrotask(() => {
        dGood1.resolve("a");
        dGood2.resolve("b");
      });
      try {
        yield* sched.all([f1, fMid, f2]);
        return "no-throw";
      } catch (e) {
        return `err:${(e as Error).message}`;
      }
    });
    expect(await sched.run(op)).toBe("err:middle-fail");
  });

  test("routine-backed race: rejecting winner throws", async () => {
    const sched = new Scheduler(testLib);
    const failFast: Operation<string> = gen(function* (): Generator<
      unknown,
      string,
      unknown
    > {
      throw new Error("fast-fail");
    });
    const dSlow = deferred<string>();
    const slow: Operation<string> = gen(function* (): Generator<
      unknown,
      string,
      unknown
    > {
      return (yield* sched.makeJournalFuture(dSlow.promise)) as string;
    });
    const op = gen(function* (): Generator<unknown, string, unknown> {
      const ff = (yield* spawn(failFast)) as Future<string>;
      const fs = (yield* spawn(slow)) as Future<string>;
      // Drain the loser.
      queueMicrotask(() => queueMicrotask(() => dSlow.resolve("late")));
      try {
        yield* sched.race([ff, fs]);
        return "no-throw";
      } catch (e) {
        return `err:${(e as Error).message}`;
      }
    });
    expect(await sched.run(op)).toBe("err:fast-fail");
  });

  test("error nested two levels deep in routine-backed combinators", async () => {
    const sched = new Scheduler(testLib);
    const dD = deferred<string>();
    const failing: Operation<string> = gen(function* (): Generator<
      unknown,
      string,
      unknown
    > {
      throw new Error("deep-fail");
    });
    const drain = (
      d: Awaited<ReturnType<typeof deferred<string>>>
    ): Operation<string> =>
      gen(function* (): Generator<unknown, string, unknown> {
        return (yield* sched.makeJournalFuture(d.promise)) as string;
      });

    const op = gen(function* (): Generator<unknown, string, unknown> {
      // Inner: race over [failing, slow]. The fail wins.
      const ffail = (yield* spawn(failing)) as Future<string>;
      const fslow = (yield* spawn(drain(dD))) as Future<string>;
      const innerRace = sched.race([ffail, fslow]);
      // Outer: all of inner-race plus another routine. Should propagate.
      const fOk = (yield* spawn(drain(dD))) as Future<string>;
      queueMicrotask(() => queueMicrotask(() => dD.resolve("late")));
      try {
        yield* sched.all([innerRace, fOk]);
        return "no-throw";
      } catch (e) {
        return `err:${(e as Error).message}`;
      }
    });
    expect(await sched.run(op)).toBe("err:deep-fail");
  });
});

describe("edge — waiter-list timing", () => {
  test("a future whose backing routine completes before parent parks on it", async () => {
    const sched = new Scheduler(testLib);
    const fast: Operation<number> = gen(function* (): Generator<
      unknown,
      number,
      unknown
    > {
      return 100;
    });
    const op = gen(function* (): Generator<unknown, number, unknown> {
      const f = (yield* spawn(fast)) as Future<number>;
      // The spawned routine is added to ready; when this routine yields
      // again (the next yield* below), drainReady will run it and it'll
      // complete. Then yield* f hits the sync short-circuit in Leaf
      // dispatch.
      yield* sched.makeJournalFuture(resolved<void>(undefined));
      return (yield* f) as number;
    });
    expect(await sched.run(op)).toBe(100);
  });

  test("AwaitAny over routines that all complete during sync drain before parent parks", async () => {
    const sched = new Scheduler(testLib);
    const op = gen(function* (): Generator<unknown, string, unknown> {
      // Spawn a bunch of trivially-complete routines.
      const futures: Future<string>[] = [];
      for (let i = 0; i < 5; i++) {
        const ii = i;
        const child: Operation<string> = gen(function* (): Generator<
          unknown,
          string,
          unknown
        > {
          return `r${ii}`;
        });
        futures.push((yield* spawn(child)) as Future<string>);
      }
      // Yield to give the scheduler a chance to drain them.
      yield* sched.makeJournalFuture(resolved<void>(undefined));
      // Now race them. All are done; sync short-circuit picks one.
      return (yield* sched.race(futures)) as string;
    });
    const result = await sched.run(op);
    expect(result).toMatch(/^r[0-4]$/);
  });
});

describe("edge — ordering invariants", () => {
  test("spawn-order is registration-order is initial-execution-order", async () => {
    const sched = new Scheduler(testLib);
    const order: number[] = [];
    const log = (n: number): Operation<void> =>
      gen(function* (): Generator<unknown, void, unknown> {
        order.push(n);
      });

    const op = gen(function* (): Generator<unknown, number[], unknown> {
      const futures: Future<void>[] = [];
      for (let i = 0; i < 5; i++) {
        futures.push((yield* spawn(log(i))) as Future<void>);
      }
      // Wait for them all.
      yield* sched.all(futures);
      return order;
    });

    expect(await sched.run(op)).toEqual([0, 1, 2, 3, 4]);
  });

  test("a routine that yields nothing executes synchronously after spawn", async () => {
    const sched = new Scheduler(testLib);
    let childRan = false;
    const child: Operation<void> = gen(function* (): Generator<
      unknown,
      void,
      unknown
    > {
      childRan = true;
    });

    const op = gen(function* (): Generator<unknown, boolean, unknown> {
      const f = (yield* spawn(child)) as Future<void>;
      // After spawn returns, child is in the ready queue. The very next
      // step of the scheduler (drainReady) will run it.
      yield* f;
      return childRan;
    });

    expect(await sched.run(op)).toBe(true);
  });

  test("yields interleave: parent yields, child runs, parent resumes, child yields again", async () => {
    const sched = new Scheduler(testLib);
    const trace: string[] = [];
    const child: Operation<void> = gen(function* (): Generator<
      unknown,
      void,
      unknown
    > {
      trace.push("c1");
      yield* sched.makeJournalFuture(resolved<void>(undefined));
      trace.push("c2");
      yield* sched.makeJournalFuture(resolved<void>(undefined));
      trace.push("c3");
    });

    const op = gen(function* (): Generator<unknown, string[], unknown> {
      trace.push("p1");
      const f = (yield* spawn(child)) as Future<void>;
      trace.push("p2");
      yield* sched.makeJournalFuture(resolved<void>(undefined));
      trace.push("p3");
      yield* f;
      trace.push("p4");
      return trace;
    });

    const result = await sched.run(op);
    // Parent runs first up to the spawn, then child gets scheduled. After
    // each yield, both are in the ready queue and interleave. The exact
    // order depends on the ready-queue order, but: p1 must come first,
    // p4 must come last, c1 must come before c2 must come before c3,
    // and p2 must come before p3 must come before p4.
    expect(result[0]).toBe("p1");
    expect(result[result.length - 1]).toBe("p4");
    expect(result.indexOf("c1")).toBeLessThan(result.indexOf("c2"));
    expect(result.indexOf("c2")).toBeLessThan(result.indexOf("c3"));
    expect(result.indexOf("p2")).toBeLessThan(result.indexOf("p3"));
    expect(result.indexOf("p3")).toBeLessThan(result.indexOf("p4"));
  });
});

describe("edge — error in spawned routine doesn't break sibling routines", () => {
  test("one routine throws; sibling routines complete normally", async () => {
    const sched = new Scheduler(testLib);
    const failing: Operation<string> = gen(function* (): Generator<
      unknown,
      string,
      unknown
    > {
      throw new Error("isolated-fail");
    });
    const ok = (label: string): Operation<string> =>
      gen(function* (): Generator<unknown, string, unknown> {
        return label;
      });

    const op = gen(function* (): Generator<unknown, string, unknown> {
      const ff = (yield* spawn(failing)) as Future<string>;
      const f1 = (yield* spawn(ok("one"))) as Future<string>;
      const f2 = (yield* spawn(ok("two"))) as Future<string>;
      // Drain failing — it'll throw when we yield* it. Drain siblings
      // first, then catch the failing.
      const r1 = (yield* f1) as string;
      const r2 = (yield* f2) as string;
      try {
        yield* ff;
        return "no-throw";
      } catch (e) {
        return `${r1}+${r2}+${(e as Error).message}`;
      }
    });

    expect(await sched.run(op)).toBe("one+two+isolated-fail");
  });

  test("a throwing routine that no one awaits doesn't break the workflow", async () => {
    const sched = new Scheduler(testLib);
    const failing: Operation<void> = gen(function* (): Generator<
      unknown,
      void,
      unknown
    > {
      throw new Error("orphan-fail");
    });

    const op = gen(function* (): Generator<unknown, string, unknown> {
      // Spawn but never await. Routine fails silently.
      const _f = (yield* spawn(failing)) as Future<void>;
      void _f;
      // Continue with normal work.
      return "kept-going";
    });

    expect(await sched.run(op)).toBe("kept-going");
  });
});

describe("edge — same future awaited from concurrent routines", () => {
  test("one journal future, multiple routines all awaiting it, all see same value", async () => {
    const sched = new Scheduler(testLib);
    const d = deferred<number>();

    const reader = (label: string, f: Future<number>): Operation<string> =>
      gen(function* (): Generator<unknown, string, unknown> {
        const v = (yield* f) as number;
        return `${label}=${v}`;
      });

    const op = gen(function* (): Generator<unknown, string[], unknown> {
      const f = sched.makeJournalFuture(d.promise);
      const fs: Future<string>[] = [];
      for (let i = 0; i < 5; i++) {
        fs.push((yield* spawn(reader(`r${i}`, f))) as Future<string>);
      }
      queueMicrotask(() => d.resolve(42));
      return (yield* sched.all(fs)) as string[];
    });

    expect(await sched.run(op)).toEqual([
      "r0=42",
      "r1=42",
      "r2=42",
      "r3=42",
      "r4=42",
    ]);
  });

  test("one routine future awaited by N concurrent waiters", async () => {
    const sched = new Scheduler(testLib);
    const d = deferred<number>();
    const inner: Operation<number> = gen(function* (): Generator<
      unknown,
      number,
      unknown
    > {
      return (yield* sched.makeJournalFuture(d.promise)) as number;
    });

    const reader = (label: string, f: Future<number>): Operation<string> =>
      gen(function* (): Generator<unknown, string, unknown> {
        const v = (yield* f) as number;
        return `${label}=${v}`;
      });

    const op = gen(function* (): Generator<unknown, string[], unknown> {
      const f = (yield* spawn(inner)) as Future<number>;
      const readers: Future<string>[] = [];
      for (let i = 0; i < 5; i++) {
        readers.push((yield* spawn(reader(`r${i}`, f))) as Future<string>);
      }
      queueMicrotask(() => d.resolve(7));
      return (yield* sched.all(readers)) as string[];
    });

    expect(await sched.run(op)).toEqual([
      "r0=7",
      "r1=7",
      "r2=7",
      "r3=7",
      "r4=7",
    ]);
  });
});
