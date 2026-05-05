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
import { deferred, rejected, resolved, testLib } from "./test-promise.js";

describe("select — basics", () => {
  test("returns the tag of the branch that settled first", async () => {
    const sched = new Scheduler(testLib);
    const dA = deferred<string>();
    const dB = deferred<string>();
    const op = gen(function* (): Generator<unknown, string, unknown> {
      const fA = sched.makeJournalFuture(dA.promise);
      const fB = sched.makeJournalFuture(dB.promise);
      const r = yield* select({ a: fA, b: fB });
      return r.tag;
    });
    const result = sched.run(op);
    queueMicrotask(() => dB.resolve("hello"));
    expect(await result).toBe("b");
    dA.resolve("never-seen");
  });

  test("returns the future itself, which the user can unwrap", async () => {
    const sched = new Scheduler(testLib);
    const dA = deferred<string>();
    const op = gen(function* (): Generator<unknown, string, unknown> {
      const fA = sched.makeJournalFuture(dA.promise);
      const fB = sched.makeJournalFuture(resolved("instant"));
      const r = yield* select({ a: fA, b: fB });
      // Unwrap the chosen future.
      const v = (yield* r.future) as string;
      return `${r.tag}=${v}`;
    });
    expect(await sched.run(op)).toBe("b=instant");
    dA.resolve("never-seen");
  });

  test("an already-settled branch wins immediately (sync short-circuit)", async () => {
    const sched = new Scheduler(testLib);
    const dA = deferred<string>();
    const op = gen(function* (): Generator<unknown, string, unknown> {
      const fA = sched.makeJournalFuture(dA.promise);
      const fB = sched.makeJournalFuture(resolved("ready"));
      const r = yield* select({ slow: fA, fast: fB });
      return r.tag;
    });
    expect(await sched.run(op)).toBe("fast");
    dA.resolve("late");
  });

  test("rejection only surfaces when the user unwraps the future", async () => {
    const sched = new Scheduler(testLib);
    const op = gen(function* (): Generator<unknown, string, unknown> {
      const fGood = sched.makeJournalFuture(resolved<string>("good"));
      const fBad = sched.makeJournalFuture(rejected<string>(new Error("bad")));
      // Both branches are ready synchronously; either could win the sync
      // short-circuit. We test that *whichever* is selected, throwing only
      // happens on unwrap.
      const r = yield* select({ good: fGood, bad: fBad });
      try {
        const v = (yield* r.future) as string;
        return `ok:${r.tag}:${v}`;
      } catch (e) {
        return `err:${r.tag}:${(e as Error).message}`;
      }
    });
    const result = await sched.run(op);
    // Either branch may settle first since both are sync-ready promises.
    // Whichever wins, the result encodes which one and what happened.
    expect(["ok:good:good", "err:bad:bad"]).toContain(result);
  });
});

describe("select — Tokio-style loops", () => {
  test("loop with terminal+tick branches breaks when terminal fires", async () => {
    const sched = new Scheduler(testLib);
    let ticks = 0;
    const dDone = deferred<string>();
    const op = gen(function* (): Generator<unknown, string, unknown> {
      const fDone = sched.makeJournalFuture(dDone.promise);
      while (true) {
        const r = yield* select({
          done: fDone,
          tick: sched.makeJournalFuture(resolved<void>(undefined)),
        });
        if (r.tag === "done") return (yield* r.future) as string;
        ticks++;
        if (ticks > 5) {
          queueMicrotask(() => dDone.resolve("finished"));
        }
        if (ticks > 100) throw new Error("runaway loop");
      }
    });
    const result = await sched.run(op);
    expect(result).toBe("finished");
    expect(ticks).toBeGreaterThan(0);
    expect(ticks).toBeLessThan(100);
  });

  test("multiple consecutive selects resolve to different branches as expected", async () => {
    const sched = new Scheduler(testLib);
    const op = gen(function* (): Generator<unknown, string, unknown> {
      const fA = sched.makeJournalFuture(resolved("a"));
      const fB = sched.makeJournalFuture(resolved("b"));
      const fC = sched.makeJournalFuture(resolved("c"));
      // Three branches: any sync-ready one wins, but Object.keys preserves
      // insertion order so we can predict which.
      const r1 = yield* select({ a: fA, b: fB, c: fC });
      const r2 = yield* select({ b: fB, c: fC });
      return `${r1.tag},${r2.tag}`;
    });
    expect(await sched.run(op)).toBe("a,b");
  });
});

describe("select — spawn-backed branches", () => {
  test("can mix journal and routine-backed branches", async () => {
    const sched = new Scheduler(testLib);
    const dJournal = deferred<string>();
    const slowRoutine: Operation<string> = gen(function* (): Generator<
      unknown,
      string,
      unknown
    > {
      return (yield* sched.makeJournalFuture(dJournal.promise)) as string;
    });
    const op = gen(function* (): Generator<unknown, string, unknown> {
      const fRoutine = (yield* spawn(slowRoutine)) as Future<string>;
      const fJournal = sched.makeJournalFuture(resolved("journal-fast"));
      const r = yield* select({ task: fRoutine, j: fJournal });
      return r.tag;
    });
    const result = sched.run(op);
    // Journal wins; routine completes later.
    queueMicrotask(() => queueMicrotask(() => dJournal.resolve("never-mind")));
    expect(await result).toBe("j");
  });

  test("returns the spawned future when it wins, value retrievable", async () => {
    const sched = new Scheduler(testLib);
    const fast: Operation<number> = gen(function* (): Generator<
      unknown,
      number,
      unknown
    > {
      return 42;
    });
    const op = gen(function* (): Generator<unknown, number, unknown> {
      const fFast = (yield* spawn(fast)) as Future<number>;
      const dSlow = deferred<number>();
      const fSlow = sched.makeJournalFuture(dSlow.promise);
      const r = yield* select({ fast: fFast, slow: fSlow });
      const v = (yield* r.future) as number;
      queueMicrotask(() => dSlow.resolve(0));
      return v;
    });
    expect(await sched.run(op)).toBe(42);
  });
});

describe("select — type narrowing (compile-time only)", () => {
  // This test doesn't assert at runtime — it's here to make the type-narrowing
  // story executable as code. If the types regress, tsc will catch it.
  test("the SelectResult tag/future pairing typechecks correctly", async () => {
    const sched = new Scheduler(testLib);
    const op = gen(function* (): Generator<unknown, string, unknown> {
      const fStr = sched.makeJournalFuture(resolved<string>("s"));
      const fNum = sched.makeJournalFuture(resolved<number>(7));
      const r = yield* select({ s: fStr, n: fNum });
      switch (r.tag) {
        case "s": {
          const v = (yield* r.future) as string;
          return `s:${v}`;
        }
        case "n": {
          const v = (yield* r.future) as number;
          return `n:${v}`;
        }
      }
    });
    expect(await sched.run(op)).toMatch(/^[sn]:/);
  });
});
