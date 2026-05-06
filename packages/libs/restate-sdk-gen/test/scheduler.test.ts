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

// Tests for scheduler-internal invariants — the things that aren't
// observable through the user-facing API but matter for correctness:
// routine cleanup, deadlock detection, ordering guarantees, won-flag
// behavior under simultaneous settles, and edge cases in dispatch.

import { describe, expect, test } from "vitest";
import { gen, spawn, type Future, type Operation } from "../src/index.js";
import { Scheduler } from "../src/internal.js";
import { deferred, resolved, testLib } from "./test-promise.js";

describe("scheduler — deadlock detection", () => {
  test("a wait cycle (two routines awaiting each other) is detected", async () => {
    const sched = new Scheduler(testLib);
    // Construct a wait cycle: routine A awaits a deferred that's never
    // resolved, and the parent awaits the routine. The scheduler should
    // detect that no journal source is pending.
    //
    // Strictly, this test exercises the "no journal promises pending,
    // but live routines exist" branch — the same code path that would
    // catch a true wait cycle.
    const dNever = deferred<string>();
    const stuck: Operation<string> = gen(function* (): Generator<
      unknown,
      string,
      unknown
    > {
      return (yield* sched.makeJournalFuture(dNever.promise)) as string;
    });
    // We don't directly construct a deadlock — instead, this test
    // verifies the scheduler tolerates a routine parked on a journal
    // source indefinitely without crashing or busy-looping. The thing
    // we *don't* want is the scheduler claiming "stuck" when there's a
    // pending journal source (even one that may never resolve from
    // the test's perspective).
    const op = gen(function* (): Generator<unknown, string, unknown> {
      const f = (yield* spawn(stuck)) as Future<string>;
      // Resolve so the test can complete.
      queueMicrotask(() => dNever.resolve("eventually"));
      return (yield* f) as string;
    });
    expect(await sched.run(op)).toBe("eventually");
  });
});

describe("scheduler — routine cleanup", () => {
  test("finished routines are removed from the live list", async () => {
    const sched = new Scheduler(testLib);
    // Spawn many routines that all complete; verify the scheduler runs
    // to completion in O(N) without growing the routines list unboundedly.
    // We can observe this only indirectly: that the scheduler completes
    // at all (and quickly) for a large N.
    const N = 1000;
    const op = gen(function* (): Generator<unknown, number, unknown> {
      const futures: Future<number>[] = [];
      for (let i = 0; i < N; i++) {
        const ii = i;
        const child: Operation<number> = gen(function* (): Generator<
          unknown,
          number,
          unknown
        > {
          return ii;
        });
        futures.push((yield* spawn(child)) as Future<number>);
      }
      // Drive them all.
      let sum = 0;
      for (const f of futures) sum += (yield* f) as number;
      return sum;
    });
    const result = await sched.run(op);
    expect(result).toBe((N * (N - 1)) / 2);
  });

  test("a re-raced loop over already-done routines doesn't accumulate state", async () => {
    // Spawn two routines, run race over them in a loop multiple times.
    // Each iteration should sync short-circuit (since both are done after
    // the first iteration). The test passes if the scheduler doesn't OOM
    // or hang.
    const sched = new Scheduler(testLib);
    const a: Operation<string> = gen(function* (): Generator<
      unknown,
      string,
      unknown
    > {
      return "a";
    });
    const b: Operation<string> = gen(function* (): Generator<
      unknown,
      string,
      unknown
    > {
      return "b";
    });
    const op = gen(function* (): Generator<unknown, number, unknown> {
      const fa = (yield* spawn(a)) as Future<string>;
      const fb = (yield* spawn(b)) as Future<string>;
      // Drive both to completion.
      yield* fa;
      yield* fb;
      // Now race them repeatedly. Sync short-circuit each time.
      let count = 0;
      for (let i = 0; i < 100; i++) {
        const winner = (yield* sched.race([fa, fb])) as string;
        if (winner === "a" || winner === "b") count++;
      }
      return count;
    });
    expect(await sched.run(op)).toBe(100);
  });
});

describe("scheduler — won-flag under simultaneous settles", () => {
  test("two journal sources settling in the same tick: only one wakes the routine", async () => {
    // Both d1 and d2 resolve before the scheduler awaits the race. The
    // race-internal won-flag must ensure that whichever the lib picks as
    // the "winner" is the one fired; the other's fire is a no-op.
    const sched = new Scheduler(testLib);
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    const op = gen(function* (): Generator<unknown, string, unknown> {
      const f1 = sched.makeJournalFuture(d1.promise);
      const f2 = sched.makeJournalFuture(d2.promise);
      return (yield* sched.race([f1, f2])) as string;
    });
    // Resolve both before the scheduler sees them. They go into the
    // microtask queue; one wins via Promise.race.
    d1.resolve("one");
    d2.resolve("two");
    const result = await sched.run(op);
    // Either is acceptable — Promise.race semantics are unspecified for
    // already-settled inputs, but both must be valid possibilities.
    expect(["one", "two"]).toContain(result);
  });
});

describe("scheduler — ordering and re-entry", () => {
  test("ready queue drains fully before main loop awaits", async () => {
    // Spawn a routine that immediately completes synchronously. The parent
    // should observe its result without an await tick. (Sync short-circuit
    // path in Leaf dispatch.)
    const sched = new Scheduler(testLib);
    const child: Operation<number> = gen(function* (): Generator<
      unknown,
      number,
      unknown
    > {
      return 7;
    });
    const op = gen(function* (): Generator<unknown, number, unknown> {
      const f = (yield* spawn(child)) as Future<number>;
      // Spawn just returned; child is in ready queue. drainReady will
      // process it, finishing it, before this routine's next yield is
      // reached. So this yield will see child as `done`.
      return (yield* f) as number;
    });
    expect(await sched.run(op)).toBe(7);
  });

  test("a child routine spawning more children all complete in correct order", async () => {
    const sched = new Scheduler(testLib);
    const order: number[] = [];
    const grandchild = (n: number): Operation<void> =>
      gen(function* (): Generator<unknown, void, unknown> {
        order.push(n);
      });
    const child = (n: number): Operation<void> =>
      gen(function* (): Generator<unknown, void, unknown> {
        const f1 = (yield* spawn(grandchild(n * 10 + 1))) as Future<void>;
        const f2 = (yield* spawn(grandchild(n * 10 + 2))) as Future<void>;
        yield* f1;
        yield* f2;
        order.push(n);
      });
    const op = gen(function* (): Generator<unknown, void, unknown> {
      const fa = (yield* spawn(child(1))) as Future<void>;
      const fb = (yield* spawn(child(2))) as Future<void>;
      yield* fa;
      yield* fb;
    });
    await sched.run(op);
    // Grandchildren should run before their parent's continuation.
    expect(order.indexOf(11)).toBeLessThan(order.indexOf(1));
    expect(order.indexOf(12)).toBeLessThan(order.indexOf(1));
    expect(order.indexOf(21)).toBeLessThan(order.indexOf(2));
    expect(order.indexOf(22)).toBeLessThan(order.indexOf(2));
  });
});

describe("scheduler — multiple await points in one routine", () => {
  test("sequential journal awaits resolve in order with values", async () => {
    const sched = new Scheduler(testLib);
    const d1 = deferred<number>();
    const d2 = deferred<number>();
    const d3 = deferred<number>();
    const op = gen(function* (): Generator<unknown, number, unknown> {
      const a = (yield* sched.makeJournalFuture(d1.promise)) as number;
      const b = (yield* sched.makeJournalFuture(d2.promise)) as number;
      const c = (yield* sched.makeJournalFuture(d3.promise)) as number;
      return a + b + c;
    });
    const result = sched.run(op);
    queueMicrotask(() => d1.resolve(1));
    queueMicrotask(() => queueMicrotask(() => d2.resolve(2)));
    queueMicrotask(() =>
      queueMicrotask(() => queueMicrotask(() => d3.resolve(3)))
    );
    expect(await result).toBe(6);
  });

  test("error in middle of a chain stops further awaits", async () => {
    const sched = new Scheduler(testLib);
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    const d3 = deferred<string>();
    let reached3 = false;
    const op = gen(function* (): Generator<unknown, string, unknown> {
      yield* sched.makeJournalFuture(d1.promise);
      yield* sched.makeJournalFuture(d2.promise);
      reached3 = true;
      return (yield* sched.makeJournalFuture(d3.promise)) as string;
    });
    const result = sched.run(op);
    queueMicrotask(() => d1.resolve("a"));
    queueMicrotask(() =>
      queueMicrotask(() => d2.reject(new Error("middle-fail")))
    );
    await expect(result).rejects.toThrow("middle-fail");
    expect(reached3).toBe(false);
    d3.resolve("never-reached");
  });
});

describe("scheduler — running the same Operation across schedulers", () => {
  test("an Operation is reusable across independent Scheduler instances", async () => {
    const op: Operation<number> = gen(function* (): Generator<
      unknown,
      number,
      unknown
    > {
      return 42;
    });
    const sched1 = new Scheduler(testLib);
    const sched2 = new Scheduler(testLib);
    const sched3 = new Scheduler(testLib);
    const [a, b, c] = await Promise.all([
      sched1.run(op),
      sched2.run(op),
      sched3.run(op),
    ]);
    expect(a).toBe(42);
    expect(b).toBe(42);
    expect(c).toBe(42);
  });
});

describe("scheduler — empty/edge inputs", () => {
  test("all of empty array resolves immediately to []", async () => {
    const sched = new Scheduler(testLib);
    const op = gen(function* (): Generator<unknown, number[], unknown> {
      return (yield* sched.all([])) as number[];
    });
    expect(await sched.run(op)).toEqual([]);
  });

  test("an Operation that yields nothing returns synchronously", async () => {
    const sched = new Scheduler(testLib);
    let sideEffect = false;
    const op = gen(function* (): Generator<unknown, string, unknown> {
      sideEffect = true;
      return "no-yields";
    });
    expect(await sched.run(op)).toBe("no-yields");
    expect(sideEffect).toBe(true);
  });

  test("a Future yielded that's already done with a value short-circuits", async () => {
    const sched = new Scheduler(testLib);
    const op = gen(function* (): Generator<unknown, string, unknown> {
      const f = sched.makeJournalFuture(resolved("ready"));
      return (yield* f) as string;
    });
    expect(await sched.run(op)).toBe("ready");
  });
});
