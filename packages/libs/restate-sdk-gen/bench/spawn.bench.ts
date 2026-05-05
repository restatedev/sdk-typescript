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

// Spawn / fiber-creation throughput.
//
// Fan out N child fibers from a parent, all-join them. Every child
// returns immediately, so this measures fiber lifecycle overhead:
// creation, ready-queue churn, advance-once-and-finish, waiter wakeup.

import { bench, describe } from "vitest";
import { gen, spawn } from "../src/operation.js";
import type { Future } from "../src/future.js";
import { newSched, BENCH_OPTS } from "./_helpers.js";

const sizes = [10, 100, 1000] as const;

for (const N of sizes) {
  describe(`spawn ${N} routines, all-join`, () => {
    bench(
      `${N}× spawn(empty) + all`,
      async () => {
        const sched = newSched();
        await sched.run(
          gen(function* () {
            const ts = new Array<Future<number>>(N);
            for (let i = 0; i < N; i++) {
              ts[i] = yield* spawn(
                gen(function* () {
                  return i;
                })
              );
            }
            yield* sched.all(ts);
          })
        );
      },
      BENCH_OPTS
    );
  });
}
