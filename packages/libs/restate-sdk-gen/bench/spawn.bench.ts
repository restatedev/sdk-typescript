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
