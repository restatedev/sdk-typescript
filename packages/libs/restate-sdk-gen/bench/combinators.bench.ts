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

// Combinator scaling: all/race over journal-backed inputs.
//
// All inputs are pre-resolved Awaitables so we measure the journal
// fast-path: `every(isJournalBacked) === true`, single `lib.all` /
// `lib.race` call, no fallback fiber. This isolates the cost of
// constructing N futures and joining them in a single combinator
// entry — the production-relevant case for parallel I/O.

import { bench, describe } from "vitest";
import { gen } from "../src/operation.js";
import type { Future } from "../src/future.js";
import { newSched, ok, BENCH_OPTS } from "./_helpers.js";

const sizes = [10, 100, 1000] as const;

for (const N of sizes) {
  describe(`all(${N}) — journal fast-path`, () => {
    bench(
      `all(${N}× makeJournalFuture)`,
      async () => {
        const sched = newSched();
        await sched.run(
          gen(function* () {
            const fs = new Array<Future<number>>(N);
            for (let i = 0; i < N; i++) {
              fs[i] = sched.makeJournalFuture(ok(i));
            }
            yield* sched.all(fs);
          })
        );
      },
      BENCH_OPTS
    );
  });

  describe(`race(${N}) — journal fast-path`, () => {
    bench(
      `race(${N}× makeJournalFuture)`,
      async () => {
        const sched = newSched();
        await sched.run(
          gen(function* () {
            const fs = new Array<Future<number>>(N);
            for (let i = 0; i < N; i++) {
              fs[i] = sched.makeJournalFuture(ok(i));
            }
            yield* sched.race(fs);
          })
        );
      },
      BENCH_OPTS
    );
  });
}
