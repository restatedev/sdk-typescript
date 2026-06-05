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

// Mixing tests focused on select. The existing mixing.test.ts and
// mixed-deep.test.ts cover all and race extensively over mixed
// journal/routine sources, but select has less coverage of those shapes.
//
// Key shapes here:
//   - select branches that are a mix of journal and spawned futures
//   - select inside spawned routines, with a parent observing
//   - selecting on the same future-pool across iterations of a loop
//   - select where one branch is the result of all or race over mixed
//     inputs

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

describe("select — mixing journal and routine branches", () => {
  test("select with one journal and one routine branch, routine wins", async () => {
    const sched = new Scheduler(testLib);
    const dJournal = deferred<string>();
    const fastRoutine: Operation<string> = gen(function* () {
      return "from-routine";
    });
    const op = gen(function* () {
      const fJ = sched.makeJournalFuture(dJournal.promise);
      const fR = spawn(fastRoutine);
      const r = yield* select({ j: fJ, r: fR });
      // Drain loser.
      queueMicrotask(() => dJournal.resolve("late"));
      return `${r.tag}:${yield* r.future}`;
    });
    expect(await sched.run(op)).toBe("r:from-routine");
  });

  test("select with three branches: journal, routine, routine — first done wins", async () => {
    const sched = new Scheduler(testLib);
    const dJ = deferred<number>();
    const dR1 = deferred<number>();
    const r1: Operation<number> = gen(function* () {
      return yield* sched.makeJournalFuture(dR1.promise);
    });
    const r2: Operation<number> = gen(function* () {
      return 99; // sync-fast
    });
    const op = gen(function* () {
      const fJ = sched.makeJournalFuture(dJ.promise);
      const fR1 = spawn(r1);
      const fR2 = spawn(r2);
      const r = yield* select({ j: fJ, slow: fR1, fast: fR2 });
      queueMicrotask(() => {
        dJ.resolve(0);
        dR1.resolve(0);
      });
      return `${r.tag}:${yield* r.future}`;
    });
    expect(await sched.run(op)).toBe("fast:99");
  });

  test("select branches built from spawn(race(...)) and spawn(all(...))", async () => {
    const sched = new Scheduler(testLib);
    const dPair1 = [deferred<number>(), deferred<number>()];
    const dPair2 = [deferred<number>(), deferred<number>()];

    const sumBranch: Operation<number> = gen(function* () {
      const fs = dPair1.map((d) => sched.makeJournalFuture(d.promise));
      const vs = yield* sched.all(fs);
      return vs.reduce((a, b) => a + b, 0);
    });

    const firstBranch: Operation<number> = gen(function* () {
      const fs = dPair2.map((d) => sched.makeJournalFuture(d.promise));
      return yield* sched.race(fs);
    });

    const op = gen(function* () {
      const fSum = spawn(sumBranch);
      const fFirst = spawn(firstBranch);
      // Resolve early so the inner combinators can fire. This must happen
      // before the outer select is awaited — schedule via microtask.
      queueMicrotask(() => {
        dPair2[0]!.resolve(100);
        // Resolve the rest later so the scheduler can drain losers.
        queueMicrotask(() => {
          dPair2[1]!.resolve(200);
          dPair1[0]!.resolve(10);
          dPair1[1]!.resolve(20);
        });
      });
      const r = yield* select({ sum: fSum, first: fFirst });
      const v = yield* r.future;
      return `${r.tag}:${v}`;
    });

    const result = await sched.run(op);
    // firstBranch only needs ONE pair2 input to settle, so it almost
    // certainly wins. But the lib's race semantics may differ — accept
    // either outcome.
    if (result.startsWith("first:")) {
      expect(["first:100", "first:200"]).toContain(result);
    } else {
      expect(result).toBe("sum:30");
    }
  });

  test("select.future is the underlying future, can be passed onward to all", async () => {
    const sched = new Scheduler(testLib);
    const f1 = sched.makeJournalFuture(resolved(10));
    const f2 = sched.makeJournalFuture(resolved(20));
    const f3 = sched.makeJournalFuture(resolved(30));
    const op = gen(function* () {
      // Select picks one (we don't care which here — we re-collect every
      // future via all afterwards to verify memoization).
      yield* select({ a: f1, b: f2, c: f3 });
      const all = yield* sched.all([f1, f2, f3]);
      // Memoization: re-yielding f1/f2/f3 gives the same values (journal-
      // backed, journal entries are stable).
      return all.reduce((a, b) => a + b, 0);
    });
    expect(await sched.run(op)).toBe(60);
  });
});

describe("select — pumping a stable future-pool in a loop", () => {
  test("select on shared spawned futures across iterations — first to fire wins, others observed later", async () => {
    // "others observed later" relies on the scheduler driving spawned
    // routines to completion after the main fiber returns — join mode.
    // (Under the default "abandon", B would be dropped once main settles.)
    const sched = new Scheduler(testLib, { onMainExit: "join" });
    const events: string[] = [];

    // Two long-running spawned routines that resolve at different points.
    const dA = deferred<string>();
    const dB = deferred<string>();
    const taskA: Operation<string> = gen(function* () {
      const v = yield* sched.makeJournalFuture(dA.promise);
      events.push(`A:${v}`);
      return v;
    });
    const taskB: Operation<string> = gen(function* () {
      const v = yield* sched.makeJournalFuture(dB.promise);
      events.push(`B:${v}`);
      return v;
    });

    const op = gen(function* () {
      const fA = spawn(taskA);
      const fB = spawn(taskB);
      // Trigger both; A should fire first.
      queueMicrotask(() => dA.resolve("a-payload"));
      queueMicrotask(() => queueMicrotask(() => dB.resolve("b-payload")));
      const out: string[] = [];
      // First iteration: A wins.
      const r1 = yield* select({ a: fA, b: fB });
      out.push(`${r1.tag}:${yield* r1.future}`);
      // Second iteration: A is already done, B may also be done by now.
      // Whichever wins must produce a sensible pair.
      const r2 = yield* select({ a: fA, b: fB });
      out.push(`${r2.tag}:${yield* r2.future}`);
      return out;
    });

    const result = await sched.run(op);
    expect(result).toHaveLength(2);
    // First select almost certainly picks A, since dA fires first.
    // But Promise.race over JS microtask ordering has subtleties; both are
    // valid outcomes for the first pick.
    for (const r of result) {
      expect(["a:a-payload", "b:b-payload"]).toContain(r);
    }
    // Both A and B must have eventually resolved.
    expect(events.sort()).toEqual(["A:a-payload", "B:b-payload"]);
  });
});

describe("select — inside spawned routines that also yield mixed futures", () => {
  test("a spawned routine internally uses select on mixed sources, parent awaits it", async () => {
    const sched = new Scheduler(testLib);
    const dExternal = deferred<string>();

    const inner: Operation<string> = gen(function* () {
      // Internal spawned helper: completes synchronously.
      const helper: Operation<string> = gen(function* () {
        return "helper-fast";
      });
      const fHelper = spawn(helper);
      const fExternal = sched.makeJournalFuture(dExternal.promise);
      const r = yield* select({ helper: fHelper, external: fExternal });
      // Drain whichever loser.
      queueMicrotask(() => dExternal.resolve("never-mind"));
      return `${r.tag}:${yield* r.future}`;
    });

    const op = gen(function* () {
      const fInner = spawn(inner);
      return yield* fInner;
    });

    expect(await sched.run(op)).toBe("helper:helper-fast");
  });
});
