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

// Tests for cross-routine communication patterns: one routine producing a
// value that another awaits via a shared deferred, multiple routines
// participating in coordination, and the kind of orchestration patterns
// that show up in real workflows.

import { describe, expect, test } from "vitest";
import { gen, spawn, type Future, type Operation } from "../src/index.js";
import { Scheduler } from "../src/internal.js";
import { deferred, testLib } from "./test-promise.js";

describe("cross-routine — one signals another", () => {
  test("producer routine resolves a deferred that consumer awaits", async () => {
    const sched = new Scheduler(testLib);
    const channel = deferred<string>();

    const consumer = gen(function* () {
      return yield* sched.makeJournalFuture(channel.promise);
    });

    const op = gen(function* () {
      // Wire up the consumer first, then trigger via external signal.
      const fc = spawn(consumer);
      // Simulate "external" resolution via microtask.
      queueMicrotask(() => channel.resolve("payload"));
      return yield* fc;
    });

    expect(await sched.run(op)).toBe("payload");
  });

  test("multiple consumers all observe the same resolved value", async () => {
    const sched = new Scheduler(testLib);
    const channel = deferred<number>();

    const consumer = (id: number): Operation<string> =>
      gen(function* () {
        const v = yield* sched.makeJournalFuture(channel.promise);
        return `c${id}=${v}`;
      });

    const op = gen(function* () {
      const f1 = spawn(consumer(1));
      const f2 = spawn(consumer(2));
      const f3 = spawn(consumer(3));
      queueMicrotask(() => channel.resolve(99));
      return yield* sched.all([f1, f2, f3]);
    });

    expect(await sched.run(op)).toEqual(["c1=99", "c2=99", "c3=99"]);
  });
});

describe("cross-routine — pipelining", () => {
  test("a chain of routines passing values through", async () => {
    const sched = new Scheduler(testLib);
    // stage1 -> stage2 -> stage3, each transforming the previous output.
    const stage = (label: string, input: Future<number>): Operation<number> =>
      gen(function* () {
        const v = yield* input;
        return v + label.length;
      });

    const op = gen(function* () {
      const d0 = deferred<number>();
      const f0 = sched.makeJournalFuture(d0.promise);
      const f1 = spawn(stage("aa", f0));
      const f2 = spawn(stage("bbb", f1));
      const f3 = spawn(stage("cccc", f2));
      queueMicrotask(() => d0.resolve(10));
      return yield* f3;
    });

    // 10 + 2 + 3 + 4 = 19
    expect(await sched.run(op)).toBe(19);
  });

  test("fan-out then fan-in", async () => {
    const sched = new Scheduler(testLib);
    const compute = (n: number): Operation<number> =>
      gen(function* () {
        return n * n;
      });
    const op = gen(function* () {
      // Fan-out: spawn N workers.
      const futures: Future<number>[] = [];
      for (let i = 1; i <= 5; i++) {
        futures.push(spawn(compute(i)));
      }
      // Fan-in: collect all.
      const results = yield* sched.all(futures);
      return results.reduce((a, b) => a + b, 0);
    });
    // 1 + 4 + 9 + 16 + 25 = 55
    expect(await sched.run(op)).toBe(55);
  });
});

describe("cross-routine — racing across spawn boundaries", () => {
  test("racing the parent's local future against a spawned child", async () => {
    const sched = new Scheduler(testLib);
    const dParent = deferred<string>();
    const childOp: Operation<string> = gen(function* () {
      return "from-child";
    });
    const op = gen(function* () {
      const fParent = sched.makeJournalFuture(dParent.promise);
      const fChild = spawn(childOp);
      // child completes synchronously; parent is deferred.
      const winner = yield* sched.race([fParent, fChild]);
      // Resolve parent so scheduler can drain the loser.
      queueMicrotask(() => dParent.resolve("from-parent"));
      return winner;
    });
    expect(await sched.run(op)).toBe("from-child");
  });

  test("two routines each waiting on the same shared future", async () => {
    const sched = new Scheduler(testLib);
    const shared = deferred<number>();

    const observer = (label: string): Operation<string> =>
      gen(function* () {
        const v = yield* sched.makeJournalFuture(shared.promise);
        return `${label}:${v}`;
      });

    const op = gen(function* () {
      const fa = spawn(observer("A"));
      const fb = spawn(observer("B"));
      queueMicrotask(() => shared.resolve(7));
      const a = yield* fa;
      const b = yield* fb;
      return `${a},${b}`;
    });

    expect(await sched.run(op)).toBe("A:7,B:7");
  });
});

describe("cross-routine — recursive patterns", () => {
  test("a routine spawning itself recursively", async () => {
    const sched = new Scheduler(testLib);
    const fib = (n: number): Operation<number> =>
      gen(function* () {
        if (n < 2) return n;
        const f1 = spawn(fib(n - 1));
        const f2 = spawn(fib(n - 2));
        const a = yield* f1;
        const b = yield* f2;
        return a + b;
      });
    expect(await sched.run(fib(10))).toBe(55);
  });

  test("a routine spawning N children that themselves spawn N grandchildren", async () => {
    const sched = new Scheduler(testLib);
    const branch = (depth: number, label: number): Operation<number> =>
      gen(function* () {
        if (depth === 0) return label;
        const futures: Future<number>[] = [];
        for (let i = 0; i < 3; i++) {
          futures.push(
            spawn(branch(depth - 1, label * 10 + i))
          );
        }
        const results = yield* sched.all(futures);
        return results.reduce((a, b) => a + b, 0);
      });
    // Tree of depth 2, branching factor 3 = 9 leaves with labels 0,1,2,10,11,12,...
    // Their sum is 0+1+2+10+11+12+20+21+22 = 99.
    expect(await sched.run(branch(2, 0))).toBe(99);
  });
});
