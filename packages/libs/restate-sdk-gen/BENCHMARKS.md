# Benchmarks

`make bench` runs in-process micro-benchmarks under Vitest's `bench`
runner. They measure scheduler/dispatch overhead — not Restate I/O —
by driving the scheduler with pre-resolved Awaitables. The numbers
below are illustrative; rerun on your machine for current values.

The point is **relative cost**: how many microseconds does the
generator+scheduler indirection add above raw `await`? In production,
each yield typically waits on a Restate journal RPC (milliseconds at
best, usually more), so the scheduler overhead is in the noise. These
benches let us catch regressions early and quantify the fast-path
optimization for combinators.

## What's measured

```
bench/
├── _helpers.ts              shared scheduler/awaitable construction
├── baseline.bench.ts        raw `await` and `Promise.all` (lower bound)
├── scheduler.bench.ts       gen + sequential `yield* makeJournalFuture`
├── combinators.bench.ts     all / race fast-path at N=10/100/1000
└── spawn.bench.ts           spawn + all-join at N=10/100/1000
```

Every input Awaitable is pre-resolved, so the wall time is dominated
by `Fiber.advance`, marker dispatch, ready-queue management, and the
main-loop race iteration — exactly the parts the DSL adds.

## What's NOT measured

- **Restate journal latency**. These benches don't talk to a
  restate-server; they measure pure scheduler overhead. For
  end-to-end numbers, run `make integration` and read the suite's
  per-profile timings (~6 min total for 210 tests across 7 profiles).
- **Real promise scheduling**. Pre-resolved Awaitables short-circuit
  most of `Promise.all`'s coordination work. A workload with pending
  I/O sees different scaling.
- **Slot overhead**. The current-fiber slot is two module-variable
  writes per `Fiber.advance`; well below the noise floor of these
  benches. The free functions read the slot once per call — also
  nanoseconds.

## Sample budget

Tinybench (Vitest's bench engine) defaults to `time: 500` ms and
`iterations: 64` per case — a *minimum*; it keeps sampling until
both are met. Cheap ops (baseline) saturate the iteration ceiling
fast and rack up millions of samples. Expensive ones (spawn 1000 at
~1.8 ms/iter) only fit ~270 samples in 500 ms → ±7-9% RME, too loose
to draw conclusions.

We pin `time: 3000` per `bench()` call (via `BENCH_OPTS` in
`bench/_helpers.ts`). That gets the slowest workloads to >1500
samples and pulls RME to ~3-4%; cheap workloads still finish under
their own iteration ceiling. Total `make bench` runtime: ~1 minute.

If you change a bench and want tighter numbers, bump `BENCH_OPTS.time`
locally — at the cost of proportionally longer runtime. ~10 s/case is
needed for ±1% RME on spawn(1000); rarely worth it for routine work.

## Latest numbers (M-series Mac, Node 22, 3 s/case)

Per-iteration cost ≈ `mean ms` ÷ `N`. Native baselines included for
context. RME shown alongside.

| Benchmark | N=10 | N=100 | N=1000 | per-op (large N) | RME @ N=1000 |
|---|---|---|---|---|---|
| **baseline** `await Promise.resolve()` | 0.3 µs | 2.6 µs | 24 µs | ~24 ns | ±0.11% |
| **baseline** `Promise.all([...resolved])` | 0.4 µs | 2.7 µs | 26 µs | ~26 ns | ±0.19% |
| `gen` + N× `yield* makeJournalFuture` | 12 µs | 111 µs | 1.10 ms | **~1.10 µs / yield** | ±2.0% |
| `all` fast-path | 4.8 µs | 30 µs | 309 µs | **~310 ns / future** | ±2.4% |
| `race` fast-path | 5.7 µs | 43 µs | 384 µs | **~380 ns / future** | ±0.2% |
| `spawn` empty + `all`-join | 20 µs | 187 µs | 1.96 ms | **~1.96 µs / spawn-join** | ±4.0% |

## Reading the numbers

- **Sequential yield: ~1 µs.** Roughly 40× a bare `await
  Promise.resolve()`. In production each yield is journaled — Restate
  RPC latency dominates, scheduler overhead is round-off.
- **all fast-path: ~280 ns / future.** All-journal-backed inputs
  collapse to one `lib.all` call → one combinator entry on the wire.
  Linear in N because we still walk the array to extract underlying
  promises.
- **Spawn + join: ~1.8 µs.** Includes fiber creation, ready-queue
  push, advance-once-and-finish, waiter wakeup. Comparable to what
  you'd pay for a manually-managed Promise routine.
- **race ≈ 1.3× all.** Slightly more bookkeeping (won-flag, source
  list construction); still cheap.

## Running them

```bash
make bench                                     # all benches
pnpm --filter restate-fluent run bench         # same, direct
pnpm --filter restate-fluent run bench -- \
  bench/combinators.bench.ts                   # filter to one file
```

Output is Vitest's bench format: hz (ops/sec), min/max/mean ms,
percentiles, RME (relative margin of error), sample count.

## Adding a new benchmark

Drop a `*.bench.ts` under `packages/restate-fluent/bench/`. Keep
iterations bounded (the file headers default to `iterations: 100`)
because the measurement loop runs each call as a fresh scheduler;
unbounded runs balloon memory.

Pattern:

```ts
import { bench, describe } from "vitest";
import { gen } from "../src/operation.js";
import { newSched, ok } from "./_helpers.js";

describe("my workload", () => {
  bench(
    "name shown in output",
    async () => {
      const sched = newSched();
      await sched.run(gen(function* () {
        // ... workload ...
      }));
    },
    { iterations: 100 }
  );
});
```
