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

// Baseline: raw async/await + Promise.all.
//
// Lower bound on what the scheduler is competing with. The fluent
// scheduler adds dispatch, ready-queue, and main-loop race overhead
// on top of native promise scheduling — these benches let us quantify
// the multiplier per workload size.

import { bench, describe } from "vitest";
import { BENCH_OPTS } from "./_helpers.js";

const sizes = [10, 100, 1000] as const;

for (const N of sizes) {
  describe(`baseline ${N} awaits`, () => {
    bench(
      `${N}× await Promise.resolve()`,
      async () => {
        for (let i = 0; i < N; i++) {
          await Promise.resolve(i);
        }
      },
      BENCH_OPTS
    );
  });

  describe(`baseline Promise.all(${N})`, () => {
    bench(
      `Promise.all(${N}× resolved)`,
      async () => {
        const ps = new Array<Promise<number>>(N);
        for (let i = 0; i < N; i++) ps[i] = Promise.resolve(i);
        await Promise.all(ps);
      },
      BENCH_OPTS
    );
  });
}
