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

// Cancellation tests.
//
// Cancellation, in the Restate SDK's default mode, is delivered by
// settling the race promise itself with a TerminalError rejection while
// leaving the underlying journal promises untouched. Our scheduler
// observes this by catching the rejection of `lib.race(tagged)` in the
// main loop, then fanning the same TerminalError out to every parked
// routine. Each routine wakes with TerminalError thrown at its current
// yield site. The routine can catch and continue normally — subsequent
// yields are not poisoned, because we construct fresh race promises
// each iteration.
//
// The test substrate `cancellingLib()` returns a lib + a cancel(e)
// function that mirrors the SDK behavior: it rejects the currently-
// pending race promise with the given error; future race promises
// (constructed after cancellation is delivered) are unaffected.

import { describe, expect, test } from "vitest";
import { gen, spawn, type Future, type Operation } from "../src/index.js";
import { Scheduler } from "../src/internal.js";
import { cancellingLib, deferred } from "./test-promise.js";

// Stand-in for restate.TerminalError with the cancellation code. The
// scheduler doesn't inspect the error type — it just propagates whatever
// the lib's race rejects with. So the test can use any error class.
class CancelError extends Error {
  readonly code = "CANCELLED";
  constructor() {
    super("Invocation cancelled");
    this.name = "TerminalError";
  }
}

describe("cancellation — basic delivery", () => {
  test("cancellation arriving while routine is parked: routine sees TerminalError", async () => {
    const { lib, cancel } = cancellingLib();
    const sched = new Scheduler(lib);
    const dWork = deferred<string>();
    const op = gen(function* (): Generator<unknown, string, unknown> {
      try {
        const v = (yield* sched.makeJournalFuture(dWork.promise)) as string;
        return `done:${v}`;
      } catch (e) {
        return `caught:${(e as Error).message}`;
      }
    });
    const result = sched.run(op);
    queueMicrotask(() => cancel(new CancelError()));
    expect(await result).toBe("caught:Invocation cancelled");
    // dWork is still pending; resolve it to clean up.
    dWork.resolve("late");
  });

  test("uncaught cancellation propagates out of the scheduler", async () => {
    const { lib, cancel } = cancellingLib();
    const sched = new Scheduler(lib);
    const dWork = deferred<string>();
    const op = gen(function* (): Generator<unknown, string, unknown> {
      return (yield* sched.makeJournalFuture(dWork.promise)) as string;
    });
    const result = sched.run(op);
    queueMicrotask(() => cancel(new CancelError()));
    await expect(result).rejects.toThrow("Invocation cancelled");
    dWork.resolve("late");
  });
});

describe("cancellation — recovery", () => {
  test("routine catches cancel, yields again, gets normal value (cancellation is not sticky)", async () => {
    const { lib, cancel } = cancellingLib();
    const sched = new Scheduler(lib);
    const dWork = deferred<string>();
    const dCleanup = deferred<string>();
    const op = gen(function* (): Generator<unknown, string, unknown> {
      try {
        return (yield* sched.makeJournalFuture(dWork.promise)) as string;
      } catch (e) {
        // After catching, the next yield must work normally — cancellation
        // is delivered once and the next race promise is fresh.
        const cleanup = (yield* sched.makeJournalFuture(
          dCleanup.promise
        )) as string;
        return `recovered:${cleanup}:${(e as Error).message}`;
      }
    });
    const result = sched.run(op);
    queueMicrotask(() => cancel(new CancelError()));
    queueMicrotask(() => queueMicrotask(() => dCleanup.resolve("ok")));
    expect(await result).toBe("recovered:ok:Invocation cancelled");
    dWork.resolve("ignored");
  });

  test("multiple sequential cancellations: each is delivered, each is recoverable", async () => {
    const { lib, cancel } = cancellingLib();
    const sched = new Scheduler(lib);
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    const d3 = deferred<string>();
    const log: string[] = [];

    const op = gen(function* (): Generator<unknown, string, unknown> {
      try {
        yield* sched.makeJournalFuture(d1.promise);
      } catch (e) {
        log.push(`c1:${(e as Error).message}`);
      }
      try {
        yield* sched.makeJournalFuture(d2.promise);
      } catch (e) {
        log.push(`c2:${(e as Error).message}`);
      }
      const v = (yield* sched.makeJournalFuture(d3.promise)) as string;
      log.push(`d3:${v}`);
      return log.join("|");
    });

    const result = sched.run(op);
    // First cancel: hits the d1 yield.
    queueMicrotask(() => cancel(new CancelError()));
    // Second cancel: hits the d2 yield.
    queueMicrotask(() =>
      queueMicrotask(() => queueMicrotask(() => cancel(new CancelError())))
    );
    // Resolve d3 so the routine can finish normally.
    queueMicrotask(() =>
      queueMicrotask(() =>
        queueMicrotask(() =>
          queueMicrotask(() =>
            queueMicrotask(() => queueMicrotask(() => d3.resolve("third")))
          )
        )
      )
    );
    expect(await result).toBe(
      "c1:Invocation cancelled|c2:Invocation cancelled|d3:third"
    );
    d1.resolve("never1");
    d2.resolve("never2");
  });
});

describe("cancellation — fan-out across multiple parked routines", () => {
  test("cancel reaches every parked routine, each can react independently", async () => {
    const { lib, cancel } = cancellingLib();
    const sched = new Scheduler(lib);
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    const log: string[] = [];

    const child = (label: string, d: typeof d1): Operation<string> =>
      gen(function* (): Generator<unknown, string, unknown> {
        try {
          const v = (yield* sched.makeJournalFuture(d.promise)) as string;
          log.push(`${label}:done:${v}`);
          return v;
        } catch {
          log.push(`${label}:cancelled`);
          return `${label}-cancelled`;
        }
      });

    const op = gen(function* (): Generator<unknown, string, unknown> {
      const fa = (yield* spawn(child("A", d1))) as Future<string>;
      const fb = (yield* spawn(child("B", d2))) as Future<string>;
      const a = (yield* fa) as string;
      const b = (yield* fb) as string;
      return `${a},${b}`;
    });

    const result = sched.run(op);
    queueMicrotask(() => cancel(new CancelError()));
    expect(await result).toBe("A-cancelled,B-cancelled");
    expect(log.sort()).toEqual(["A:cancelled", "B:cancelled"]);
    d1.resolve("late1");
    d2.resolve("late2");
  });

  test("AwaitAny over journal sources: cancel delivers TerminalError once via won-flag", async () => {
    const { lib, cancel } = cancellingLib();
    const sched = new Scheduler(lib);
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    const d3 = deferred<string>();

    const op = gen(function* (): Generator<unknown, string, unknown> {
      const f1 = sched.makeJournalFuture(d1.promise);
      const f2 = sched.makeJournalFuture(d2.promise);
      const f3 = sched.makeJournalFuture(d3.promise);
      try {
        return (yield* sched.race([f1, f2, f3])) as string;
      } catch (e) {
        return `race-cancelled:${(e as Error).message}`;
      }
    });

    const result = sched.run(op);
    queueMicrotask(() => cancel(new CancelError()));
    expect(await result).toBe("race-cancelled:Invocation cancelled");
    d1.resolve("late1");
    d2.resolve("late2");
    d3.resolve("late3");
  });

  test("some routines catch, some don't: caught ones recover, uncaught ones propagate", async () => {
    const { lib, cancel } = cancellingLib();
    const sched = new Scheduler(lib);
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    const d3 = deferred<string>();

    const recoveringChild: Operation<string> = gen(function* (): Generator<
      unknown,
      string,
      unknown
    > {
      try {
        return (yield* sched.makeJournalFuture(d1.promise)) as string;
      } catch {
        // Recover by reading another deferred.
        const v = (yield* sched.makeJournalFuture(d2.promise)) as string;
        return `recovered:${v}`;
      }
    });

    const propagatingChild: Operation<string> = gen(function* (): Generator<
      unknown,
      string,
      unknown
    > {
      // No try/catch — cancellation propagates out.
      return (yield* sched.makeJournalFuture(d3.promise)) as string;
    });

    const op = gen(function* (): Generator<unknown, string, unknown> {
      const fr = (yield* spawn(recoveringChild)) as Future<string>;
      const fp = (yield* spawn(propagatingChild)) as Future<string>;
      const r = (yield* fr) as string;
      try {
        const p = (yield* fp) as string;
        return `${r}|${p}`;
      } catch (e) {
        return `${r}|propagated:${(e as Error).message}`;
      }
    });

    const result = sched.run(op);
    queueMicrotask(() => cancel(new CancelError()));
    queueMicrotask(() => queueMicrotask(() => d2.resolve("step2")));
    expect(await result).toBe(
      "recovered:step2|propagated:Invocation cancelled"
    );
    d1.resolve("late1");
    d3.resolve("late3");
  });
});

describe("cancellation — interaction with all", () => {
  test("all in flight: cancel propagates as the all result", async () => {
    const { lib, cancel } = cancellingLib();
    const sched = new Scheduler(lib);
    const d1 = deferred<number>();
    const d2 = deferred<number>();
    const d3 = deferred<number>();

    const op = gen(function* (): Generator<unknown, string, unknown> {
      const fs = [d1, d2, d3].map((d) => sched.makeJournalFuture(d.promise));
      try {
        const vs = (yield* sched.all(fs)) as number[];
        return `done:${vs.join(",")}`;
      } catch (e) {
        return `cancelled:${(e as Error).message}`;
      }
    });

    const result = sched.run(op);
    // Resolve one source, then cancel before the others settle.
    queueMicrotask(() => d1.resolve(1));
    queueMicrotask(() => queueMicrotask(() => cancel(new CancelError())));
    expect(await result).toBe("cancelled:Invocation cancelled");
    d2.resolve(2);
    d3.resolve(3);
  });
});

describe("cancellation — non-cancellation race rejections also fan out", () => {
  test("any rejection of the race promise fans out to all parked routines", async () => {
    // The scheduler doesn't distinguish cancellation from other race-level
    // rejections — any rejection of the aggregate race promise fans out.
    // This is the right behavior: such rejections indicate scheduler-level
    // failures that should surface to all routines uniformly.
    const { lib, cancel } = cancellingLib();
    const sched = new Scheduler(lib);
    const d1 = deferred<string>();
    const d2 = deferred<string>();

    const op = gen(function* (): Generator<unknown, string, unknown> {
      const child = (label: string, d: typeof d1): Operation<string> =>
        gen(function* (): Generator<unknown, string, unknown> {
          try {
            return (yield* sched.makeJournalFuture(d.promise)) as string;
          } catch (e) {
            return `${label}:${(e as Error).message}`;
          }
        });
      const fa = (yield* spawn(child("A", d1))) as Future<string>;
      const fb = (yield* spawn(child("B", d2))) as Future<string>;
      const a = (yield* fa) as string;
      const b = (yield* fb) as string;
      return `${a}|${b}`;
    });

    const result = sched.run(op);
    queueMicrotask(() => cancel(new Error("transport-broke")));
    expect(await result).toBe("A:transport-broke|B:transport-broke");
    d1.resolve("late1");
    d2.resolve("late2");
  });
});
