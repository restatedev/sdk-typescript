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

// Stress tests. The scheduler should handle many routines, deep
// recursion, long sequences of yields, and high turnover without
// growing memory unboundedly or timing out. These tests would catch:
//   - O(N^2) walks over `routines` if cleanup isn't working
//   - stack overflows from synchronous recursion
//   - leaks in the waiter-list bookkeeping

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

describe("stress — many concurrent spawns", () => {
  test("10,000 concurrent spawned routines all complete", async () => {
    const sched = new Scheduler(testLib);
    const N = 10_000;
    const op = gen(function* (): Generator<unknown, number, unknown> {
      const futures: Future<number>[] = [];
      for (let i = 0; i < N; i++) {
        const ii = i;
        const child: Operation<number> = gen(function* (): Generator<
          unknown,
          number,
          unknown
        > {
          return ii;
        });
        futures.push((yield* spawn(child)) as Future<number>);
      }
      let sum = 0;
      for (const f of futures) sum += (yield* f) as number;
      return sum;
    });
    const result = await sched.run(op);
    expect(result).toBe((N * (N - 1)) / 2);
  });

  test("1,000 spawns each yielding once, then awaited", async () => {
    const sched = new Scheduler(testLib);
    const N = 1_000;
    const op = gen(function* (): Generator<unknown, number, unknown> {
      const futures: Future<number>[] = [];
      for (let i = 0; i < N; i++) {
        const ii = i;
        const child: Operation<number> = gen(function* (): Generator<
          unknown,
          number,
          unknown
        > {
          // One real journal yield per child.
          yield* sched.makeJournalFuture(resolved<void>(undefined));
          return ii;
        });
        futures.push((yield* spawn(child)) as Future<number>);
      }
      const results = (yield* sched.all(futures)) as number[];
      return results.reduce((a, b) => a + b, 0);
    });
    expect(await sched.run(op)).toBe((N * (N - 1)) / 2);
  });
});

describe("stress — long sequential yield chains", () => {
  test("a single routine yielding 1,000 journal futures in sequence", async () => {
    const sched = new Scheduler(testLib);
    const N = 1_000;
    const op = gen(function* (): Generator<unknown, number, unknown> {
      let sum = 0;
      for (let i = 0; i < N; i++) {
        const v = (yield* sched.makeJournalFuture(resolved(i))) as number;
        sum += v;
      }
      return sum;
    });
    expect(await sched.run(op)).toBe((N * (N - 1)) / 2);
  });

  test("nested gen 100 levels deep", async () => {
    const sched = new Scheduler(testLib);
    const D = 100;
    const build = (n: number): Operation<number> =>
      gen(function* (): Generator<unknown, number, unknown> {
        if (n === 0) return 0;
        const inner = (yield* build(n - 1)) as number;
        return inner + 1;
      });
    expect(await sched.run(build(D))).toBe(D);
  });
});

describe("stress — high turnover", () => {
  test("loop spawning and awaiting routines 500 times", async () => {
    const sched = new Scheduler(testLib);
    const ITER = 500;
    const op = gen(function* (): Generator<unknown, number, unknown> {
      let total = 0;
      for (let i = 0; i < ITER; i++) {
        const ii = i;
        const child: Operation<number> = gen(function* (): Generator<
          unknown,
          number,
          unknown
        > {
          return ii;
        });
        const f = (yield* spawn(child)) as Future<number>;
        total += (yield* f) as number;
      }
      return total;
    });
    expect(await sched.run(op)).toBe((ITER * (ITER - 1)) / 2);
  });

  test("nested race in a loop with fresh futures each iteration", async () => {
    const sched = new Scheduler(testLib);
    const ITER = 200;
    const op = gen(function* (): Generator<unknown, number, unknown> {
      let count = 0;
      for (let i = 0; i < ITER; i++) {
        const f1 = sched.makeJournalFuture(resolved(i));
        const f2 = sched.makeJournalFuture(resolved(i + 1000));
        const winner = (yield* sched.race([f1, f2])) as number;
        if (winner === i || winner === i + 1000) count++;
      }
      return count;
    });
    expect(await sched.run(op)).toBe(ITER);
  });
});

describe("stress — fan-out fan-in patterns", () => {
  test("spawn 100 parallel all chains", async () => {
    const sched = new Scheduler(testLib);
    const PARALLEL = 100;
    const CHAIN = 10;
    const chain: Operation<number> = gen(function* (): Generator<
      unknown,
      number,
      unknown
    > {
      const futures: Future<number>[] = [];
      for (let i = 0; i < CHAIN; i++) {
        futures.push(sched.makeJournalFuture(resolved(i)));
      }
      const results = (yield* sched.all(futures)) as number[];
      return results.reduce((a, b) => a + b, 0);
    });
    const op = gen(function* (): Generator<unknown, number, unknown> {
      const futures: Future<number>[] = [];
      for (let i = 0; i < PARALLEL; i++) {
        futures.push((yield* spawn(chain)) as Future<number>);
      }
      const results = (yield* sched.all(futures)) as number[];
      return results.reduce((a, b) => a + b, 0);
    });
    // PARALLEL chains, each summing 0..CHAIN-1 = (CHAIN * (CHAIN-1))/2 = 45
    // So total: PARALLEL * 45.
    expect(await sched.run(op)).toBe(PARALLEL * ((CHAIN * (CHAIN - 1)) / 2));
  });
});

describe("stress — settle order doesn't matter", () => {
  test("100 deferreds resolved in reverse order; all returns in input order", async () => {
    const sched = new Scheduler(testLib);
    const N = 100;
    const ds = Array.from({ length: N }, () => deferred<number>());
    const op = gen(function* (): Generator<unknown, number[], unknown> {
      const futures = ds.map((d) => sched.makeJournalFuture(d.promise));
      return (yield* sched.all(futures)) as number[];
    });
    const result = sched.run(op);
    // Resolve in reverse.
    for (let i = N - 1; i >= 0; i--) {
      ds[i]!.resolve(i);
    }
    const arr = await result;
    expect(arr).toHaveLength(N);
    for (let i = 0; i < N; i++) expect(arr[i]).toBe(i);
  });
});
