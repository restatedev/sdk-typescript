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

// onMainExit — what happens to spawned fibers when the main fiber
// settles.
//
//   "abandon" (default): run() returns as soon as the main fiber
//   settles; still-running spawned fibers are abandoned at their
//   current suspension point and never resumed.
//
//   "join": run() keeps driving until every fiber has finished — the
//   pre-abandon behavior.

import { describe, expect, test } from "vitest";
import { gen, race, spawn } from "../src/index.js";
import { Scheduler } from "../src/internal.js";
import { cancellingLib, deferred, resolved, testLib } from "./test-promise.js";

describe("onMainExit: 'abandon' (default)", () => {
  test("run resolves when main settles even though a spawned fiber is parked on a never-settling source", async () => {
    const sched = new Scheduler(testLib);
    const never = deferred<void>();
    const child = gen(function* () {
      yield* sched.makeJournalFuture(never.promise);
    });
    const op = gen(function* () {
      spawn(child);
      // Park once so the child actually gets to run and park too.
      yield* sched.makeJournalFuture(resolved("tick"));
      return "done";
    });
    // Under "join" this would hang forever on `never`.
    expect(await sched.run(op)).toBe("done");
  });

  test("an abandoned fiber's continuation never executes, even if its source settles later", async () => {
    const sched = new Scheduler(testLib);
    const d = deferred<string>();
    let childResumed = false;
    const child = gen(function* () {
      yield* sched.makeJournalFuture(d.promise);
      childResumed = true;
    });
    const op = gen(function* () {
      spawn(child);
      yield* sched.makeJournalFuture(resolved("tick"));
      return 1;
    });
    expect(await sched.run(op)).toBe(1);
    // Settle the abandoned child's source after run() returned — the
    // child must not be woken; there is no scheduler driving it.
    d.resolve("late");
    await new Promise((r) => setTimeout(r, 0));
    expect(childResumed).toBe(false);
  });

  test("a child still in the ready queue when main finishes never advances (prompt stop)", async () => {
    const sched = new Scheduler(testLib);
    let childStarted = false;
    const child = gen(function* () {
      childStarted = true;
    });
    const op = gen(function* () {
      spawn(child); // queued behind the running main
      return "parent-done"; // main settles before the child's first advance
    });
    expect(await sched.run(op)).toBe("parent-done");
    expect(childStarted).toBe(false);
  });

  test("race against a spawned routine: the losing routine is abandoned once main settles", async () => {
    const sched = new Scheduler(testLib);
    const fast = deferred<string>();
    const never = deferred<string>();
    const op = gen(function* () {
      const slow = spawn(
        gen(function* () {
          return yield* sched.makeJournalFuture(never.promise);
        })
      );
      const quick = sched.makeJournalFuture(fast.promise);
      const winner = yield* race([quick, slow]);
      return winner;
    });
    queueMicrotask(() => fast.resolve("fast"));
    // Under "join" this hangs: the losing routine stays parked on
    // `never` and keeps the scheduler alive (the documented race-loser
    // footgun).
    expect(await sched.run(op)).toBe("fast");
  });

  test("a rejecting main abandons spawned fibers and rejects immediately", async () => {
    const sched = new Scheduler(testLib);
    const never = deferred<void>();
    const op = gen(function* () {
      spawn(
        gen(function* () {
          yield* sched.makeJournalFuture(never.promise);
        })
      );
      yield* sched.makeJournalFuture(resolved("tick"));
      throw new Error("boom");
    });
    await expect(sched.run(op)).rejects.toThrow("boom");
  });

  test("after main handles cancellation and returns, spawned fibers are abandoned mid-recovery", async () => {
    const { lib, cancel } = cancellingLib();
    const sched = new Scheduler(lib);
    const dChild = deferred<void>();
    let childRecovered = false;
    const op = gen(function* () {
      spawn(
        gen(function* () {
          try {
            yield* sched.makeJournalFuture(dChild.promise);
          } catch {
            childRecovered = true;
          }
        })
      );
      const dMain = deferred<string>();
      try {
        yield* sched.makeJournalFuture(dMain.promise);
        return "unreachable";
      } catch {
        return "cancelled-and-done";
      }
    });
    queueMicrotask(() => cancel(new Error("cancel!")));
    // The fan-out wakes main first (FIFO); main returns, so the child's
    // catch block never runs — abandoned at its yield point.
    expect(await sched.run(op)).toBe("cancelled-and-done");
    expect(childRecovered).toBe(false);
  });

  test("an unawaited combinator fallback (all over mixed futures) is abandoned with its inputs", async () => {
    const sched = new Scheduler(testLib);
    const d = deferred<string>();
    let harvested = false;
    const op = gen(function* () {
      const routine = spawn(
        gen(function* () {
          const v = yield* sched.makeJournalFuture(d.promise);
          harvested = true;
          return v;
        })
      );
      // A mixed input forces the fallback that synthesizes a fiber; the
      // combined future is stored but never yielded — so the
      // synthesizer (and the routine it harvests) is abandoned when
      // main settles, exactly like a bare spawn.
      void sched.all([routine, sched.makeJournalFuture(resolved("j"))]);
      yield* sched.makeJournalFuture(resolved("tick"));
      return "done";
    });
    expect(await sched.run(op)).toBe("done");
    d.resolve("late");
    await new Promise((r) => setTimeout(r, 0));
    expect(harvested).toBe(false);
  });

  test("spawned fibers that main awaits are driven to completion as usual", async () => {
    const sched = new Scheduler(testLib);
    const d = deferred<number>();
    const op = gen(function* () {
      const child = spawn(
        gen(function* () {
          return (yield* sched.makeJournalFuture(d.promise)) * 2;
        })
      );
      queueMicrotask(() => d.resolve(21));
      return yield* child;
    });
    expect(await sched.run(op)).toBe(42);
  });
});

describe("onMainExit: 'join'", () => {
  test("run waits for fire-and-forget children to finish", async () => {
    const sched = new Scheduler(testLib, undefined, { onMainExit: "join" });
    let childRan = false;
    const child = gen(function* () {
      yield* sched.makeJournalFuture(resolved("ok"));
      childRan = true;
    });
    const op = gen(function* () {
      spawn(child);
      return "parent-done";
    });
    expect(await sched.run(op)).toBe("parent-done");
    expect(childRan).toBe(true);
  });

  test("run waits for a parked child whose source settles after main returns", async () => {
    const sched = new Scheduler(testLib, undefined, { onMainExit: "join" });
    const d = deferred<void>();
    let childDone = false;
    const op = gen(function* () {
      spawn(
        gen(function* () {
          yield* sched.makeJournalFuture(d.promise);
          childDone = true;
        })
      );
      queueMicrotask(() => d.resolve());
      return 7;
    });
    expect(await sched.run(op)).toBe(7);
    expect(childDone).toBe(true);
  });
});
