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

// Bench helpers — settled-promise sources at zero latency.
//
// Most benchmarks want to measure scheduler/dispatch overhead, not
// promise scheduling. We use already-resolved Awaitables so the cost
// is dominated by `Fiber.advance`, marker dispatch, ready-queue
// management, and the main loop's race iteration — not by the wall
// time of pending I/O.

import { Scheduler, type Awaitable } from "../src/internal.js";
import { testLib, resolved } from "../test/test-promise.js";

export { testLib, resolved };

/** Construct a fresh scheduler — the benchmark target. */
export function newSched(): Scheduler {
  return new Scheduler(testLib);
}

/** A pre-resolved Awaitable<T> for journal-backed Future construction. */
export function ok<T>(v: T): Awaitable<T> {
  return resolved(v);
}

/**
 * Tinybench measurement budget per `bench()` case.
 *
 * Defaults (`time: 500`, `iterations: 64`) are too loose for our
 * expensive workloads — spawn(1000) at ~1.8 ms/iter gets only ~270
 * samples, ±8% RME. Bumping to 3 s gives >1500 samples on the
 * slowest benches → ~2-3% RME, while keeping total runtime ~1 min.
 *
 * Cheap benches still finish under their respective time budgets
 * with millions of samples (Tinybench's iteration cap is high).
 */
export const BENCH_OPTS = { time: 3000 } as const;
