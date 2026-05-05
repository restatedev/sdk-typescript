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

// Tests focused on the AwaitAny won-flag: the closure that ensures only
// the first source to settle wakes the waiting routine. Bugs here would
// look like double-wakes (routine resumes twice with stale data),
// scheduler corruption (advance called on a non-ready routine), or
// dropped wakes (routine never resumes).
//
// The won-flag matters in three scenarios:
//   1. Multiple journal sources settling in the same scheduler tick —
//      the main loop processes one promise at a time, but if multiple
//      promises in `items` would all fire onto the same routine, only
//      the first should win.
//   2. Mixed sources where a routine completes synchronously during
//      drainReady right after a journal source resolves.
//   3. AwaitAny over the same future referenced multiple times.

import { describe, expect, test } from "vitest";
import {
  gen,
  spawn,
  type Future,
  type Operation,
} from "../src/index.js";
import {
  Scheduler,
} from "../src/internal.js";
import { deferred, resolved, testLib } from "./test-promise.js";

describe("won-flag — multiple journal sources ready at once", () => {
  test("when both journal sources are pre-resolved, exactly one wins", async () => {
    const sched = new Scheduler(testLib);
    const op = gen(function* (): Generator<unknown, string, unknown> {
      const f1 = sched.makeJournalFuture(resolved("first"));
      const f2 = sched.makeJournalFuture(resolved("second"));
      const winner = (yield* sched.race([f1, f2])) as string;
      // Whichever wins is fine; the test ensures we don't crash or hang.
      return winner;
    });
    const result = await sched.run(op);
    expect(["first", "second"]).toContain(result);
  });

  test("repeated race-of-already-resolved gives consistent (or arbitrary) winner each time", async () => {
    // Run race over the same pair many times. Whatever the lib decides,
    // it must return one of the values every time, never undefined or
    // crash.
    const sched = new Scheduler(testLib);
    const op = gen(function* (): Generator<unknown, string[], unknown> {
      const out: string[] = [];
      for (let i = 0; i < 50; i++) {
        const f1 = sched.makeJournalFuture(resolved("a"));
        const f2 = sched.makeJournalFuture(resolved("b"));
        out.push((yield* sched.race([f1, f2])) as string);
      }
      return out;
    });
    const results = await sched.run(op);
    expect(results.length).toBe(50);
    expect(results.every((r) => r === "a" || r === "b")).toBe(true);
  });

  test("AwaitAny with three pre-resolved sources picks one", async () => {
    const sched = new Scheduler(testLib);
    const op = gen(function* (): Generator<unknown, string, unknown> {
      const f1 = sched.makeJournalFuture(resolved("alpha"));
      const f2 = sched.makeJournalFuture(resolved("beta"));
      const f3 = sched.makeJournalFuture(resolved("gamma"));
      return (yield* sched.race([f1, f2, f3])) as string;
    });
    const result = await sched.run(op);
    expect(["alpha", "beta", "gamma"]).toContain(result);
  });
});

describe("won-flag — same future used twice in one AwaitAny", () => {
  test("a future appearing twice in the inputs doesn't double-wake", async () => {
    // The fast-path `every(isJournalBacked)` activates here; we go through
    // RestatePromise.race directly, which handles dupes natively. But the
    // slow path (with routine sources) should also handle this correctly.
    const sched = new Scheduler(testLib);
    const fast: Operation<string> = gen(function* (): Generator<
      unknown,
      string,
      unknown
    > {
      return "shared";
    });
    const op = gen(function* (): Generator<unknown, string, unknown> {
      const f = (yield* spawn(fast)) as Future<string>;
      // Pass the same Future twice into race. Sync short-circuit picks
      // the routine source; both indices point to the same fire callback.
      const winner = (yield* sched.race([f, f])) as string;
      return winner;
    });
    expect(await sched.run(op)).toBe("shared");
  });

  test("same journal future twice in race doesn't crash", async () => {
    const sched = new Scheduler(testLib);
    const op = gen(function* (): Generator<unknown, string, unknown> {
      const f = sched.makeJournalFuture(resolved("once"));
      return (yield* sched.race([f, f, f])) as string;
    });
    expect(await sched.run(op)).toBe("once");
  });
});

describe("won-flag — mixed sources with sync short-circuit", () => {
  test("a routine source that's already done wins before any journal park happens", async () => {
    const sched = new Scheduler(testLib);
    const dJournal = deferred<string>();
    const fast: Operation<string> = gen(function* (): Generator<
      unknown,
      string,
      unknown
    > {
      return "routine-sync";
    });
    const op = gen(function* (): Generator<unknown, string, unknown> {
      const fr = (yield* spawn(fast)) as Future<string>;
      // Drain so fr is "done" before the race.
      yield* fr;
      const fj = sched.makeJournalFuture(dJournal.promise);
      const winner = (yield* sched.race([fj, fr])) as string;
      // Resolve loser so scheduler can drain.
      queueMicrotask(() => dJournal.resolve("never-seen"));
      return winner;
    });
    expect(await sched.run(op)).toBe("routine-sync");
  });

  test("fast journal vs slow journal vs spawned-but-pending routine", async () => {
    const sched = new Scheduler(testLib);
    const dSlow = deferred<string>();
    const dRoutine = deferred<string>();
    const slowRoutine: Operation<string> = gen(function* (): Generator<
      unknown,
      string,
      unknown
    > {
      return (yield* sched.makeJournalFuture(dRoutine.promise)) as string;
    });
    const op = gen(function* (): Generator<unknown, string, unknown> {
      const ffast = sched.makeJournalFuture(resolved("fast"));
      const fslow = sched.makeJournalFuture(dSlow.promise);
      const fr = (yield* spawn(slowRoutine)) as Future<string>;
      const winner = (yield* sched.race([ffast, fslow, fr])) as string;
      // Drain losers.
      queueMicrotask(() => {
        dSlow.resolve("slow-late");
        dRoutine.resolve("routine-late");
      });
      return winner;
    });
    expect(await sched.run(op)).toBe("fast");
  });
});

describe("won-flag — race chained sequentially", () => {
  test("running race twice in sequence with overlapping futures", async () => {
    const sched = new Scheduler(testLib);
    const op = gen(function* (): Generator<unknown, string, unknown> {
      const fa = sched.makeJournalFuture(resolved("a"));
      const fb = sched.makeJournalFuture(resolved("b"));
      const fc = sched.makeJournalFuture(resolved("c"));
      const w1 = (yield* sched.race([fa, fb])) as string;
      const w2 = (yield* sched.race([fb, fc])) as string;
      return `${w1},${w2}`;
    });
    const result = await sched.run(op);
    // First race picks one of {a,b}; second picks one of {b,c}. So result
    // is in {a,b}×{b,c}.
    const valid = ["a,b", "a,c", "b,b", "b,c"];
    expect(valid).toContain(result);
  });
});
