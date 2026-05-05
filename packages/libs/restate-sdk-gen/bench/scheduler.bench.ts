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

// Per-yield scheduler overhead.
//
// Drives the scheduler through N yields where every Future is a
// pre-resolved Awaitable — so we measure dispatch + ready-queue cost,
// not promise scheduling. Numbers compare directly with the "raw
// async/await" baseline in baseline.bench.ts.

import { bench, describe } from "vitest";
import { gen } from "../src/operation.js";
import { newSched, ok, BENCH_OPTS } from "./_helpers.js";

const sizes = [10, 100, 1000] as const;

for (const N of sizes) {
  describe(`sequential ${N} yields`, () => {
    bench(
      `gen + ${N}× yield* makeJournalFuture`,
      async () => {
        const sched = newSched();
        await sched.run(
          gen(function* () {
            for (let i = 0; i < N; i++) {
              yield* sched.makeJournalFuture(ok(i));
            }
          })
        );
      },
      BENCH_OPTS
    );
  });
}
