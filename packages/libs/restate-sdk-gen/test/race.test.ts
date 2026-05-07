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
import { gen, spawn, type Future } from "../src/index.js";
import { Scheduler } from "../src/internal.js";
import { deferred, resolved, testLib } from "./test-promise.js";

describe("race — journal sources (fast path)", () => {
  test("returns the first to settle", async () => {
    const sched = new Scheduler(testLib);
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    const f1 = sched.makeJournalFuture(d1.promise);
    const f2 = sched.makeJournalFuture(d2.promise);
    const op = gen(function* () {
      return yield* sched.race([f1, f2]);
    });
    const result = sched.run(op);
    queueMicrotask(() => d2.resolve("two"));
    expect(await result).toBe("two");
    // Resolve the loser too so its promise doesn't sit unhandled
    d1.resolve("one");
  });

  test("rejects when the first to settle is a rejection", async () => {
    const sched = new Scheduler(testLib);
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    const f1 = sched.makeJournalFuture(d1.promise);
    const f2 = sched.makeJournalFuture(d2.promise);
    const op = gen(function* () {
      try {
        return yield* sched.race([f1, f2]);
      } catch (e) {
        return `caught: ${(e as Error).message}`;
      }
    });
    const result = sched.run(op);
    queueMicrotask(() => d1.reject(new Error("first-fail")));
    expect(await result).toBe("caught: first-fail");
    d2.resolve("loser");
  });

  test("an already-resolved input wins immediately", async () => {
    const sched = new Scheduler(testLib);
    const d = deferred<string>();
    const f1 = sched.makeJournalFuture(d.promise);
    const f2 = sched.makeJournalFuture(resolved("instant"));
    const op = gen(function* () {
      return yield* sched.race([f1, f2]);
    });
    expect(await sched.run(op)).toBe("instant");
    d.resolve("never-seen");
  });
});

describe("race — routine sources", () => {
  test("returns the first spawned routine to settle", async () => {
    const sched = new Scheduler(testLib);
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    const a = gen(function* () {
      return yield* sched.makeJournalFuture(d1.promise);
    });
    const b = gen(function* () {
      return yield* sched.makeJournalFuture(d2.promise);
    });
    const op = gen(function* () {
      const fa = spawn(a);
      const fb = spawn(b);
      queueMicrotask(() => d2.resolve("b"));
      // Resolve the loser eventually so the scheduler can drain. (No
      // cancellation: race losers run to completion in the background.)
      queueMicrotask(() => queueMicrotask(() => d1.resolve("a")));
      return yield* sched.race([fa, fb]);
    });
    expect(await sched.run(op)).toBe("b");
  });

  test("returns immediately if a routine source is already done", async () => {
    const sched = new Scheduler(testLib);
    const a = gen(function* () {
      return "instant-routine";
    });
    const op = gen(function* () {
      const fa = spawn(a);
      // Drive a to completion before the race.
      yield* fa;
      // Now race against a deferred — the done routine should win sync.
      const d = deferred<string>();
      const fd = sched.makeJournalFuture(d.promise);
      const winner = yield* sched.race([fa, fd]);
      d.resolve("never-seen");
      return winner;
    });
    expect(await sched.run(op)).toBe("instant-routine");
  });

  test("propagates rejection of the winning routine", async () => {
    const sched = new Scheduler(testLib);
    const dSlow = deferred<string>();
    const fail = gen(function* () {
      throw new Error("routine-fail");
    });
    const slow = gen(function* () {
      return yield* sched.makeJournalFuture(dSlow.promise);
    });
    const op = gen(function* () {
      const ff = spawn(fail);
      const fs = spawn(slow);
      // Loser must eventually settle since we don't cancel.
      queueMicrotask(() => queueMicrotask(() => dSlow.resolve("late")));
      try {
        yield* sched.race([ff, fs]);
        return "no-throw";
      } catch (e) {
        return (e as Error).message;
      }
    });
    expect(await sched.run(op)).toBe("routine-fail");
  });
});

describe("race — mixed sources", () => {
  test("journal wins against a slow routine", async () => {
    const sched = new Scheduler(testLib);
    const d_routine = deferred<string>();
    const r = gen(function* () {
      return yield* sched.makeJournalFuture(d_routine.promise);
    });
    const op = gen(function* () {
      const fr = spawn(r);
      const fj = sched.makeJournalFuture(resolved("journal-fast"));
      const winner = yield* sched.race([fr, fj]);
      d_routine.resolve("routine-slow");
      return winner;
    });
    expect(await sched.run(op)).toBe("journal-fast");
  });

  test("routine wins against a slow journal", async () => {
    const sched = new Scheduler(testLib);
    const d_journal = deferred<string>();
    const r = gen(function* () {
      return "routine-fast";
    });
    const op = gen(function* () {
      const fr = spawn(r);
      const fj = sched.makeJournalFuture(d_journal.promise);
      const winner = yield* sched.race([fr, fj]);
      d_journal.resolve("journal-slow");
      return winner;
    });
    expect(await sched.run(op)).toBe("routine-fast");
  });
});
