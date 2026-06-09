# @restatedev/restate-sdk-gen

A composable, generator-based DSL for [Restate](https://restate.dev/) workflows. Built around two user-visible concepts: **`Operation<T>`** (a lazy, one-shot description of work) and **`Future<T>`** (an eager, memoized handle to an eventual `T`).

For the rationale and internal architecture, see [`DESIGN.md`](./DESIGN.md). For user-facing patterns and a longer tour, see [`guide.md`](./guide.md).

## Installation

```bash
npm install @restatedev/restate-sdk @restatedev/restate-sdk-gen
```

`@restatedev/restate-sdk` is a peer dependency — bring your own SDK version.

## Quick start

```ts
import * as restate from "@restatedev/restate-sdk";
import { gen, execute, run, all } from "@restatedev/restate-sdk-gen";

const greeter = restate.service({
  name: "greeter",
  handlers: {
    greet: async (ctx: restate.Context, name: string): Promise<string> =>
      execute(
        ctx,
        gen(function* () {
          const a = run(({ signal }) => fetchA(signal), { name: "a" });
          const b = run(({ signal }) => fetchB(signal), { name: "b" });
          const [aVal, bVal] = yield* all([a, b]);
          return `${aVal}+${bVal} for ${name}`;
        })
      ),
  },
});

restate.endpoint().bind(greeter).listen();
```

`execute(ctx, op)` constructs a scheduler wired to the SDK and runs the
`Operation<T>`. The free-standing functions (`run`, `sleep`, `all`, …) inside
the generator body read the active scheduler from a synchronous current-fiber
slot — no `ops` parameter, no `AsyncLocalStorage`.

By default `execute` resolves the moment the main operation settles. Any
spawned fibers (and race losers) still running at that point are *abandoned*:
they are never resumed, their `catch`/`finally` blocks never run, and the
sources they were parked on are dropped. The stop is prompt — nothing
observable (journal writes, channel sends, side effects) happens after the
main operation's outcome is decided. Durable work a fiber already performed is
journaled as usual; only the in-memory continuation is discarded. Pass
`{ onMainExit: "join" }` as a third argument to instead keep driving until
every spawned fiber has finished (`ExecuteOptions = { onMainExit?: "abandon" |
"join" }`, both re-exported from the package).

## Two tiers, one user-visible Future

- **`Operation<T>`** — lazy, one-shot. Constructed via `gen()` for user-authored
  bodies, or by primitives that yield a marker the scheduler dispatches on.
  `gen()` takes a *factory function* (`() => Generator<...>`), not a generator
  instance — the type closes the reuse-after-exhausted trap.
- **`Future<T>`** — eager, memoized, reusable. Returned by `run`, `sleep`,
  `awakeable`, etc. (journal-backed) and by `spawn` (routine-backed). Both
  backings are indistinguishable to user code; combinators dispatch internally
  to pick the cheapest implementation.

## Primitives

Imported directly from `@restatedev/restate-sdk-gen`:

- **`run(action, opts?)`** — journaled side effect. `action` is `(opts: { signal: AbortSignal }) => Promise<T>`. Pass `signal` into AbortSignal-aware APIs (`fetch(url, { signal })`) for cancellation hygiene. Journal-entry name comes from `opts.name` if given, otherwise from `action.name` (works for named functions and `const`-bound arrows). Retry policy via `opts.retry` (`{ maxAttempts, initialInterval, maxInterval, intervalFactor, maxDuration }`).
- **`sleep(duration)`** — journaled timer.
- **`awakeable<T>()`** — journaled awakeable; returns `{ id, promise: Future<T> }`.
- **`channel<T>()`** — single-shot in-memory `Channel<T>`.
- **`state<T>()` / `sharedState<T>()`** — typed key-value store (durable, survives across invocations).
- **`contextLocal<T>(default?)`** — ambient, in-memory storage scoped to the current invocation and shared by every fiber under it. Set once near the top, read anywhere downstream without threading a parameter. Not durable — for state that must outlive the invocation, use `state()`.
- **`serviceClient` / `objectClient` / `workflowClient`** (+ `*SendClient`) — typed RPC into other Restate services.
- **`genericCall` / `genericSend`** — untyped RPC.
- **`cancel(invocationId)`** — cancel another invocation.
- **`workflowPromise(name)`** — workflow-bound durable promise.

## Combinators

- **`all(futures)`** — wait for every future, return their values in order. Heterogeneous-tuple typed (mirrors `Promise.all`).
- **`race(futures)`** — return the first to settle; the losing routines are abandoned once the main operation settles (under the default `onMainExit: "abandon"`), so their results are discarded. Under `onMainExit: "join"` the losers keep running and a loser parked on a never-settling source keeps the handler alive (see Cancellation).
- **`select({ tag1: future1, tag2: future2, ... })`** — Tokio/Go-style. Returns `{ tag, future }` of the winning branch; switch on `tag` and unwrap `future`.
- **`spawn(op)`** — register an `Operation` as a new routine; returns a `Task<T>` (a `Future<T>` plus `interrupt(err?)`). Under the default `onMainExit: "abandon"`, a spawned routine still running when the main operation settles is abandoned — fire-and-forget spawns are **not** guaranteed to complete. To ensure completion, `yield*` the returned future before returning, or run with `{ onMainExit: "join" }`.
- **`task.interrupt(err?)`** — throw `err` into a spawned routine at its next yield point (verbatim; a default `InterruptedError` if omitted) and abort its in-flight `run` I/O. **Cascades down the spawn subtree** — every routine the task spawned (transitively) is interrupted too, with the same error, so interrupting a parent winds down the whole tree it rooted; routines spawned elsewhere are untouched. The routine's own try/catch may catch and recover (interrupt is swallowable). Under the default `onMainExit: "abandon"`, interrupt-then-return abandons the routine before its cleanup runs — interrupt then `yield*` the task ("interrupt-then-join") to drive its `catch`/`finally`.

Combinators have a fast path: when every input Future is journal-backed, they collapse to a single `RestatePromise.all/race`. Otherwise they fall back to a synthesized fiber. Same semantics either way.

## Cancellation

Invocation-level cancellation (from outside, via the SDK) is delivered as a `TerminalError` thrown by the next `yield*` boundary. Catch it to do cleanup; yield more journal work afterward and the next cancellation event is independent of the previous one — cancellation is **not sticky**.

Each `run` closure receives an `{ signal }` argument — an `AbortSignal` that aborts *before* the `TerminalError` fans out to parked routines. Plumb it into AbortSignal-aware APIs (`fetch(url, { signal })`) so in-flight syscalls cancel immediately instead of waiting for cancellation to surface at the next yield.

On a cancellation fan-out the parked fibers are woken FIFO; if the main fiber catches the cancellation and returns, the remaining fibers are abandoned (their `catch` blocks may never run) under the default `onMainExit: "abandon"`.

For routine-level "stop": use a `Channel<void>` plus `select({ work, stop: stop.receive })`. Per-routine cancellation primitives are deferred — see `DESIGN.md`.

Under the default `onMainExit: "abandon"` a spawned routine or race loser parked on a never-settling source does **not** hang the handler: the handler returns as soon as the main operation settles and the parked routine is abandoned. That hang only applies under `onMainExit: "join"`, where the scheduler keeps driving until every fiber finishes.

## Repository layout

This package lives in the [`sdk-typescript`](https://github.com/restatedev/sdk-typescript) workspace. The library proper is in `src/`; auxiliary subdirectories live alongside but are not published:

```
packages/libs/restate-sdk-gen/
├── src/                # published library
├── test/               # vitest unit tests (227 tests / 22 files)
├── bench/              # vitest benchmarks
├── examples/tutorial/  # 6-tier tutorial; run with `pnpm start:tutorial`
├── e2e/                # testcontainers-based e2e; run with `pnpm test:e2e`
└── test-services/      # sdk-test-suite endpoint service
```

Only `dist/` and `README.md` are published to npm.

## Development

From the workspace root:

```bash
pnpm install
pnpm --filter @restatedev/restate-sdk-gen _test           # unit tests
pnpm --filter @restatedev/restate-sdk-gen _build          # build dist/
pnpm --filter @restatedev/restate-sdk-gen test:e2e        # e2e (Docker required)
pnpm --filter @restatedev/restate-sdk-gen start:tutorial  # boot the tutorial
pnpm --filter @restatedev/restate-sdk-gen bench           # microbenchmarks
```

For the full architecture and design rationale, read [`DESIGN.md`](./DESIGN.md). For user-facing patterns, read [`guide.md`](./guide.md). For benchmark interpretation, read [`BENCHMARKS.md`](./BENCHMARKS.md).
