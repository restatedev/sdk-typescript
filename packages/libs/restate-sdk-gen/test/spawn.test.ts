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
import { gen, spawn, type Future, type Operation } from "../src/index.js";
import { Scheduler } from "../src/internal.js";
import { deferred, resolved, testLib } from "./test-promise.js";

describe("spawn — concurrency", () => {
  test("two spawned routines run concurrently; second resolves first is OK", async () => {
    const sched = new Scheduler(testLib);
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    const f1 = sched.makeJournalFuture(d1.promise);
    const f2 = sched.makeJournalFuture(d2.promise);

    const a = gen(function* () {
      return yield* f1;
    });
    const b = gen(function* () {
      return yield* f2;
    });

    const op = gen(function* () {
      const ta = spawn(a);
      const tb = spawn(b);
      d2.resolve("two"); // resolve in reverse order
      d1.resolve("one");
      const va = yield* ta;
      const vb = yield* tb;
      return [va, vb];
    });
    expect(await sched.run(op)).toEqual(["one", "two"]);
  });

  test("many concurrent spawns settle independently", async () => {
    const sched = new Scheduler(testLib);
    const N = 20;
    const deferreds = Array.from({ length: N }, () => deferred<number>());
    const futures = deferreds.map((d) => sched.makeJournalFuture(d.promise));

    const op = gen(function* () {
      const tasks: Future<number>[] = [];
      for (let i = 0; i < N; i++) {
        const f = futures[i]!;
        const child = gen(function* () {
          return yield* f;
        });
        tasks.push(spawn(child));
      }
      // Resolve in reverse order to make sure the scheduler doesn't have a
      // left-to-right bias.
      for (let i = N - 1; i >= 0; i--) {
        deferreds[i]!.resolve(i);
      }
      const results: number[] = [];
      for (const t of tasks) results.push(yield* t);
      return results;
    });
    expect(await sched.run(op)).toEqual(Array.from({ length: N }, (_, i) => i));
  });
});

describe("spawn — fire and forget", () => {
  test("parent return abandons an unawaited child by default (onMainExit: 'abandon')", async () => {
    const sched = new Scheduler(testLib);
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
    expect(childRan).toBe(false);
  });

  test("parent can return without awaiting the spawn; child still runs under onMainExit: 'join'", async () => {
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

  test("parent return value is what the user-level run() resolves to, regardless of child state", async () => {
    const sched = new Scheduler(testLib);
    const d = deferred<void>();
    const child = gen(function* () {
      yield* sched.makeJournalFuture(d.promise);
    });
    const op = gen(function* () {
      spawn(child);
      // Resolve later — child won't be done by the time parent returns.
      queueMicrotask(() => d.resolve());
      return 7;
    });
    expect(await sched.run(op)).toBe(7);
  });
});

describe("spawn — execution order", () => {
  test("parent continues immediately after spawn (child sits in ready queue)", async () => {
    const sched = new Scheduler(testLib);
    const order: string[] = [];
    const d = deferred<void>();

    const child = gen(function* () {
      order.push("child-start");
      yield* sched.makeJournalFuture(d.promise);
      order.push("child-end");
      return "child-result";
    });

    const op = gen(function* () {
      const f = spawn(child);
      order.push("parent-after-spawn");
      queueMicrotask(() => d.resolve());
      const v = yield* f;
      order.push("parent-after-await");
      return v;
    });

    expect(await sched.run(op)).toBe("child-result");
    expect(order).toEqual([
      "parent-after-spawn",
      "child-start",
      "child-end",
      "parent-after-await",
    ]);
  });
});

describe("spawn — nesting", () => {
  test("a spawned routine can spawn its own children", async () => {
    const sched = new Scheduler(testLib);
    const grandchild = gen(function* () {
      return 7;
    });
    const child = gen(function* () {
      const g = spawn(grandchild);
      return (yield* g) * 2;
    });
    const op = gen(function* () {
      const c = spawn(child);
      return (yield* c) + 1;
    });
    expect(await sched.run(op)).toBe(15);
  });

  test("recursive spawn (10 levels) propagates a counted value", async () => {
    const sched = new Scheduler(testLib);
    const buildLevel = (n: number): Operation<number> =>
      gen(function* () {
        if (n === 0) return 0;
        const child = spawn(buildLevel(n - 1));
        return (yield* child) + 1;
      });
    expect(await sched.run(buildLevel(10))).toBe(10);
  });
});
