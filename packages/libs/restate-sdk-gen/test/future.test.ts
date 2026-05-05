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
  spawn,
  type Future,
} from "../src/index.js";
import {
  Scheduler,
} from "../src/internal.js";
import { deferred, resolved, rejected, testLib } from "./test-promise.js";

describe("Future — journal-backed", () => {
  test("yields the underlying value", async () => {
    const sched = new Scheduler(testLib);
    const f = sched.makeJournalFuture(resolved("hi"));
    const op = gen(function* (): Generator<unknown, string, unknown> {
      return (yield* f) as string;
    });
    expect(await sched.run(op)).toBe("hi");
  });

  test("propagates rejection as a thrown error", async () => {
    const sched = new Scheduler(testLib);
    const f = sched.makeJournalFuture(rejected(new Error("boom")));
    const op = gen(function* (): Generator<unknown, string, unknown> {
      try {
        yield* f;
        return "no-throw";
      } catch (e) {
        return (e as Error).message;
      }
    });
    expect(await sched.run(op)).toBe("boom");
  });

  test("can be yielded twice; both yields produce the same value", async () => {
    const sched = new Scheduler(testLib);
    const f = sched.makeJournalFuture(resolved(123));
    const op = gen(function* (): Generator<unknown, [number, number], unknown> {
      const a = (yield* f) as number;
      const b = (yield* f) as number;
      return [a, b];
    });
    expect(await sched.run(op)).toEqual([123, 123]);
  });

  test("a deferred journal future blocks until resolved", async () => {
    const sched = new Scheduler(testLib);
    const d = deferred<string>();
    const f = sched.makeJournalFuture(d.promise);
    const op = gen(function* (): Generator<unknown, string, unknown> {
      return (yield* f) as string;
    });
    const result = sched.run(op);
    // Resolve in a later microtask — the run() promise should eventually
    // resolve with "later".
    queueMicrotask(() => d.resolve("later"));
    expect(await result).toBe("later");
  });

  test("rejection of a deferred journal future surfaces as a throw", async () => {
    const sched = new Scheduler(testLib);
    const d = deferred<string>();
    const f = sched.makeJournalFuture(d.promise);
    const op = gen(function* (): Generator<unknown, string, unknown> {
      try {
        yield* f;
        return "no-throw";
      } catch (e) {
        return `caught: ${(e as Error).message}`;
      }
    });
    const result = sched.run(op);
    queueMicrotask(() => d.reject(new Error("late-fail")));
    expect(await result).toBe("caught: late-fail");
  });
});

describe("Future — routine-backed (via spawn)", () => {
  test("yields the spawned routine's return value", async () => {
    const sched = new Scheduler(testLib);
    const inner = gen(function* (): Generator<unknown, string, unknown> {
      return "from-inner";
    });
    const op = gen(function* (): Generator<unknown, string, unknown> {
      const f = (yield* spawn(inner)) as Future<string>;
      return (yield* f) as string;
    });
    expect(await sched.run(op)).toBe("from-inner");
  });

  test("propagates routine errors", async () => {
    const sched = new Scheduler(testLib);
    const inner = gen(function* (): Generator<unknown, never, unknown> {
      throw new Error("inner-fail");
    });
    const op = gen(function* (): Generator<unknown, string, unknown> {
      const f = (yield* spawn(inner)) as Future<never>;
      try {
        yield* f;
        return "no-throw";
      } catch (e) {
        return (e as Error).message;
      }
    });
    expect(await sched.run(op)).toBe("inner-fail");
  });

  test("memoization: yielding twice gives the same value", async () => {
    const sched = new Scheduler(testLib);
    let inner_runs = 0;
    const inner = gen(function* (): Generator<unknown, number, unknown> {
      inner_runs++;
      return 42;
    });
    const op = gen(function* (): Generator<unknown, [number, number], unknown> {
      const f = (yield* spawn(inner)) as Future<number>;
      const a = (yield* f) as number;
      const b = (yield* f) as number;
      return [a, b];
    });
    expect(await sched.run(op)).toEqual([42, 42]);
    expect(inner_runs).toBe(1); // body ran once even though we yielded twice
  });

  test("yielding an already-completed routine future short-circuits", async () => {
    // The Leaf dispatch has a sync short-circuit for routine-backed futures
    // whose target is already done. This test asserts that semantically;
    // we can't directly observe "no scheduler tick" from outside, but we
    // can confirm it returns the value without needing any awaitable to
    // resolve.
    const sched = new Scheduler(testLib);
    const inner = gen(function* (): Generator<unknown, number, unknown> {
      return 99;
    });
    const op = gen(function* (): Generator<unknown, number, unknown> {
      const f = (yield* spawn(inner)) as Future<number>;
      // First await drives the inner to done.
      yield* f;
      // Second await on the already-done future.
      return (yield* f) as number;
    });
    expect(await sched.run(op)).toBe(99);
  });
});

describe("Future — yield* delegation propagates settled state correctly", () => {
  test("multiple journal futures awaited in sequence", async () => {
    const sched = new Scheduler(testLib);
    const f1 = sched.makeJournalFuture(resolved(1));
    const f2 = sched.makeJournalFuture(resolved(2));
    const f3 = sched.makeJournalFuture(resolved(3));
    const op = gen(function* (): Generator<unknown, number, unknown> {
      const a = (yield* f1) as number;
      const b = (yield* f2) as number;
      const c = (yield* f3) as number;
      return a + b + c;
    });
    expect(await sched.run(op)).toBe(6);
  });

  test("error in middle yield short-circuits subsequent awaits", async () => {
    const sched = new Scheduler(testLib);
    const f1 = sched.makeJournalFuture(resolved(1));
    const f2 = sched.makeJournalFuture(rejected(new Error("middle")));
    let f3_awaited = false;
    const f3 = sched.makeJournalFuture(resolved(3));
    const op = gen(function* (): Generator<unknown, string, unknown> {
      yield* f1;
      try {
        yield* f2;
      } catch (e) {
        // Decide not to continue with f3.
        return `caught: ${(e as Error).message}`;
      }
      f3_awaited = true;
      yield* f3;
      return "no-throw";
    });
    expect(await sched.run(op)).toBe("caught: middle");
    expect(f3_awaited).toBe(false);
  });
});
