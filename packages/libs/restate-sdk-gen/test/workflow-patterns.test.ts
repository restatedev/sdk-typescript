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

// Tests modelling shapes of real-world workflows that should compose
// correctly: retry loops with exponential backoff, timeout-with-fallback,
// saga-style compensation, work-stealing fan-out, polling loops, etc.
//
// These don't test scheduler internals directly — they test that the
// shape of code an engineer would actually write composes the way the
// type system suggests it should.

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
import { deferred, resolved, testLib } from "./test-promise.js";

describe("workflow-patterns — retry with bounded attempts", () => {
  test("retry succeeds on attempt N", async () => {
    const sched = new Scheduler(testLib);
    let attempts = 0;
    const flaky = (): Operation<string> =>
      gen(function* (): Generator<unknown, string, unknown> {
        attempts++;
        if (attempts < 3) {
          // Simulate work via journal yield, then fail.
          yield* sched.makeJournalFuture(resolved<void>(undefined));
          throw new Error(`attempt ${attempts} failed`);
        }
        yield* sched.makeJournalFuture(resolved<void>(undefined));
        return `succeeded on ${attempts}`;
      });

    const retry = (max: number): Operation<string> =>
      gen(function* (): Generator<unknown, string, unknown> {
        let lastErr: unknown;
        for (let i = 0; i < max; i++) {
          try {
            return (yield* flaky()) as string;
          } catch (e) {
            lastErr = e;
          }
        }
        throw lastErr;
      });

    expect(await sched.run(retry(5))).toBe("succeeded on 3");
    expect(attempts).toBe(3);
  });

  test("retry exhausts attempts and rethrows", async () => {
    const sched = new Scheduler(testLib);
    const alwaysFails: Operation<string> = gen(function* (): Generator<
      unknown,
      string,
      unknown
    > {
      yield* sched.makeJournalFuture(resolved<void>(undefined));
      throw new Error("permanent");
    });

    const retry = (max: number): Operation<string> =>
      gen(function* (): Generator<unknown, string, unknown> {
        let lastErr: unknown = new Error("never-attempted");
        for (let i = 0; i < max; i++) {
          try {
            return (yield* alwaysFails) as string;
          } catch (e) {
            lastErr = e;
          }
        }
        throw lastErr;
      });

    await expect(sched.run(retry(3))).rejects.toThrow("permanent");
  });
});

describe("workflow-patterns — timeout with fallback", () => {
  test("operation finishes before timeout, returns its value", async () => {
    const sched = new Scheduler(testLib);
    const op = gen(function* (): Generator<unknown, string, unknown> {
      const dWork = deferred<string>();
      const dTimeout = deferred<string>();
      const fWork = sched.makeJournalFuture(dWork.promise);
      const fTimeout = sched.makeJournalFuture(dTimeout.promise);
      // Resolve work first.
      queueMicrotask(() => dWork.resolve("got it"));
      const r = yield* select({ work: fWork, timeout: fTimeout });
      // Drain timeout so scheduler can complete.
      queueMicrotask(() => dTimeout.resolve("late timeout"));
      switch (r.tag) {
        case "work":
          return (yield* r.future) as string;
        case "timeout":
          return "fallback";
      }
    });
    expect(await sched.run(op)).toBe("got it");
  });

  test("timeout fires before operation, returns fallback", async () => {
    const sched = new Scheduler(testLib);
    const op = gen(function* (): Generator<unknown, string, unknown> {
      const dWork = deferred<string>();
      const dTimeout = deferred<void>();
      const fWork = sched.makeJournalFuture(dWork.promise);
      const fTimeout = sched.makeJournalFuture(dTimeout.promise);
      queueMicrotask(() => dTimeout.resolve());
      const r = yield* select({ work: fWork, timeout: fTimeout });
      queueMicrotask(() => dWork.resolve("late work"));
      switch (r.tag) {
        case "work":
          return (yield* r.future) as string;
        case "timeout":
          return "fallback";
      }
    });
    expect(await sched.run(op)).toBe("fallback");
  });
});

describe("workflow-patterns — saga-style compensation", () => {
  test("happy path: all steps succeed", async () => {
    const sched = new Scheduler(testLib);
    const log: string[] = [];

    const reserveInventory = (): Operation<string> =>
      gen(function* (): Generator<unknown, string, unknown> {
        yield* sched.makeJournalFuture(resolved<void>(undefined));
        log.push("reserve");
        return "res-1";
      });

    const charge = (): Operation<string> =>
      gen(function* (): Generator<unknown, string, unknown> {
        yield* sched.makeJournalFuture(resolved<void>(undefined));
        log.push("charge");
        return "ch-1";
      });

    const ship = (): Operation<string> =>
      gen(function* (): Generator<unknown, string, unknown> {
        yield* sched.makeJournalFuture(resolved<void>(undefined));
        log.push("ship");
        return "shipped";
      });

    const saga = gen(function* (): Generator<unknown, string, unknown> {
      const r = (yield* reserveInventory()) as string;
      try {
        const c = (yield* charge()) as string;
        try {
          return (yield* ship()) as string;
        } catch {
          // refund charge
          log.push(`refund ${c}`);
          throw new Error("ship failed");
        }
      } catch (e) {
        // release reservation
        log.push(`release ${r}`);
        throw e;
      }
    });

    expect(await sched.run(saga)).toBe("shipped");
    expect(log).toEqual(["reserve", "charge", "ship"]);
  });

  test("compensation runs on failure", async () => {
    const sched = new Scheduler(testLib);
    const log: string[] = [];

    const reserve = (): Operation<string> =>
      gen(function* (): Generator<unknown, string, unknown> {
        yield* sched.makeJournalFuture(resolved<void>(undefined));
        log.push("reserve");
        return "res-1";
      });

    const charge = (): Operation<string> =>
      gen(function* (): Generator<unknown, string, unknown> {
        yield* sched.makeJournalFuture(resolved<void>(undefined));
        log.push("charge");
        return "ch-1";
      });

    const ship = (): Operation<string> =>
      gen(function* (): Generator<unknown, string, unknown> {
        yield* sched.makeJournalFuture(resolved<void>(undefined));
        log.push("ship-attempt");
        throw new Error("warehouse down");
      });

    const saga = gen(function* (): Generator<unknown, string, unknown> {
      const r = (yield* reserve()) as string;
      try {
        const c = (yield* charge()) as string;
        try {
          return (yield* ship()) as string;
        } catch (e) {
          log.push(`refund ${c}`);
          throw e;
        }
      } catch (e) {
        log.push(`release ${r}`);
        throw e;
      }
    });

    await expect(sched.run(saga)).rejects.toThrow("warehouse down");
    expect(log).toEqual([
      "reserve",
      "charge",
      "ship-attempt",
      "refund ch-1",
      "release res-1",
    ]);
  });
});

describe("workflow-patterns — work-stealing fan-out", () => {
  test("dispatch tasks to N workers, collect results", async () => {
    const sched = new Scheduler(testLib);
    const tasks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

    const worker = (id: number): Operation<{ id: number; result: number }> =>
      gen(function* (): Generator<
        unknown,
        { id: number; result: number },
        unknown
      > {
        // Simulate work.
        yield* sched.makeJournalFuture(resolved<void>(undefined));
        return { id, result: id * id };
      });

    const op = gen(function* (): Generator<
      unknown,
      Array<{ id: number; result: number }>,
      unknown
    > {
      const futures: Future<{ id: number; result: number }>[] = [];
      for (const t of tasks) {
        futures.push(
          (yield* spawn(worker(t))) as Future<{ id: number; result: number }>
        );
      }
      return (yield* sched.all(futures)) as Array<{
        id: number;
        result: number;
      }>;
    });

    const results = await sched.run(op);
    expect(results.map((r) => r.id)).toEqual(tasks);
    expect(results.map((r) => r.result)).toEqual(tasks.map((t) => t * t));
  });
});

describe("workflow-patterns — polling loop with cancellation signal", () => {
  test("loop polls until external signal fires (via select)", async () => {
    const sched = new Scheduler(testLib);
    let polls = 0;
    const dStop = deferred<void>();

    const op = gen(function* (): Generator<unknown, number, unknown> {
      const fStop = sched.makeJournalFuture(dStop.promise);
      while (true) {
        const fPoll = sched.makeJournalFuture(resolved<number>(polls));
        const r = yield* select({ stop: fStop, poll: fPoll });
        if (r.tag === "stop") return polls;
        polls++;
        if (polls >= 5) {
          // Trigger stop synchronously — don't use microtask, since the
          // next iteration's select will race fStop and fPoll, and
          // Promise.race ordering between two sync-resolved sources is
          // not deterministic. Resolving via microtask makes the next
          // iteration potentially see *both* as ready, picking either.
          dStop.resolve();
        }
        if (polls > 100) throw new Error("runaway");
      }
    });

    // After polls reaches 5, the next iteration's select should pick stop
    // (fStop is now resolved synchronously). But the won-flag may pick
    // fPoll instead since both are sync-resolved. Accept either.
    const result = await sched.run(op);
    expect([5, 6]).toContain(result);
  });
});

describe("workflow-patterns — sequential-vs-parallel composition", () => {
  test("sequential composition gives correct order of side effects", async () => {
    const sched = new Scheduler(testLib);
    const order: number[] = [];
    const step = (n: number): Operation<void> =>
      gen(function* (): Generator<unknown, void, unknown> {
        yield* sched.makeJournalFuture(resolved<void>(undefined));
        order.push(n);
      });

    const op = gen(function* (): Generator<unknown, void, unknown> {
      yield* step(1);
      yield* step(2);
      yield* step(3);
    });

    await sched.run(op);
    expect(order).toEqual([1, 2, 3]);
  });

  test("parallel all may reorder side effects", async () => {
    const sched = new Scheduler(testLib);
    const results: number[] = [];
    const step = (n: number): Operation<number> =>
      gen(function* (): Generator<unknown, number, unknown> {
        yield* sched.makeJournalFuture(resolved<void>(undefined));
        results.push(n);
        return n;
      });

    const op = gen(function* (): Generator<unknown, number[], unknown> {
      const f1 = (yield* spawn(step(1))) as Future<number>;
      const f2 = (yield* spawn(step(2))) as Future<number>;
      const f3 = (yield* spawn(step(3))) as Future<number>;
      return (yield* sched.all([f1, f2, f3])) as number[];
    });

    const out = await sched.run(op);
    // Final values come out in input order.
    expect(out).toEqual([1, 2, 3]);
    // Side-effect order is whatever the scheduler picked; we don't assert.
    expect(results.sort()).toEqual([1, 2, 3]);
  });
});
