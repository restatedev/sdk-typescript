# @restatedev/restate-sdk-gen

A generator-based API for building durable [Restate](https://restate.dev/)
services, virtual objects, and workflows. It keeps Restate's durability model but
lets handler code compose journaled work with `yield*`, typed `Future<T>` values,
and structured concurrent routines.

The two central types are:

- **`Operation<T>`** — a lazy, one-shot description of generator work.
- **`Future<T>`** — an eager, memoized handle to a journaled operation or spawned
  routine. Yielding the same Future more than once returns the same outcome.

For user-facing patterns and a complete tour, see [`guide.md`](./guide.md). For
the scheduler model and design rationale, see [`DESIGN.md`](./DESIGN.md).

## Installation

```bash
npm install @restatedev/restate-sdk @restatedev/restate-sdk-gen
```

`@restatedev/restate-sdk` is a peer dependency, so applications choose the
compatible core SDK version themselves.

## Quick start

```ts
import * as restate from "@restatedev/restate-sdk";
import { service, run, all } from "@restatedev/restate-sdk-gen";

export const greeter = service({
  name: "Greeter",
  handlers: {
    *greet(name: string) {
      const profile = run(
        ({ signal }) => fetchProfile(name, { signal }),
        { name: "fetch-profile" }
      );
      const salutation = run(
        ({ signal }) => fetchSalutation({ signal }),
        { name: "fetch-salutation" }
      );
      const [user, hello] = yield* all([profile, salutation]);
      return `${hello}, ${user.displayName}!`;
    },
  },
});

restate.serve({ services: [greeter] });
```

Start the endpoint, register it, and invoke the handler through Restate:

```bash
restate deployments register http://localhost:9080
curl localhost:8080/Greeter/greet --json '"Ada"'
```

The Gen SDK's `service`, `object`, and `workflow` factories automatically run
generator handlers through `execute`. To use generator operations inside a
regular `@restatedev/restate-sdk` handler, call
`execute(ctx, gen(function* () { ... }))` explicitly.

Free-standing functions such as `run`, `sleep`, and `all` must be called from
the synchronous body of an active generator. Do not call them at module
initialization time, from a timer callback, or from inside a `run` closure.

## Definitions and type-safe calls

Definitions created with `service`, `object`, and `workflow` are both bindable
by `restate.serve` and usable as typed client descriptors:

```ts
import { client, object, sharedState, state } from "@restatedev/restate-sdk-gen";

type CounterState = { count: number };

export const counter = object({
  name: "Counter",
  handlers: {
    *add(delta: number) {
      const store = state<CounterState>();
      const count = (yield* store.get("count")) ?? 0;
      store.set("count", count + delta);
      return count + delta;
    },
    *get() {
      return (yield* sharedState<CounterState>().get("count")) ?? 0;
    },
  },
  options: { handlers: { get: { shared: true } } },
});

// Inside another generator handler:
const count = yield* client(counter, "counter-1").add(1);
```

Use `schemas(...)` for Standard Schema validation (Zod, Valibot, TypeBox,
and others), `serdes(...)` for explicit serializers, or `iface.*` plus
`implement(...)` to publish an interface separately from its implementation.

## Operations and Futures

- **`Operation<T>`** is lazy and one-shot. `gen()` accepts a generator factory,
  not a generator instance, which prevents accidental reuse after exhaustion.
- **`Future<T>`** is eager, memoized, and reusable. `run`, `sleep`, `awakeable`,
  calls, and state reads produce journal-backed Futures; `spawn` produces a
  routine-backed Future. Both compose through the same API.

Do not use native Promise combinators to coordinate Gen Futures. Use the Gen
SDK's `Future` combinators inside generator handlers.

## API overview

### Durable operations

- **`run(action, opts?)`** — journaled side effect. `action` receives
  `{ signal: AbortSignal }`; pass the signal to AbortSignal-aware APIs. The
  journal name comes from `opts.name` or the function's inferred name. Retry
  policy lives under `opts.retry`; custom result serialization uses
  `opts.serde`.
- **`sleep(duration, name?)`** — durable timer.
- **`awakeable<T>(serde?)`** — external callback point; returns
  `{ id, promise: Future<T> }`.
- **`resolveAwakeable(id, value)` / `rejectAwakeable(id, reason)`** — complete
  an awakeable from another handler.
- **`signal<T>(name, serde?)`** — wait for a named signal sent to the current
  invocation.
- **`workflowPromise<T>(name, serde?)`** — workflow-bound durable promise.

### Calls, state, and context

- **`client(def, key?)` / `sendClient(def, key?)`** — typed calls and sends.
- **`call(opts)` / `send(opts)`** — string-based generic calls and sends.
- **`invocation(id)` / `attach(id)` / `cancel(id)`** — refer to and manage an
  invocation. A typed call's `.invocation` Future yields the same reference.
- **`scope(key)`** — make typed calls and sends within a Restate scope.
- **`state<T>()` / `sharedState<T>()`** — typed durable key-value state.
- **`rand()` / `date()`** — deterministic random and time APIs.
- **`handlerRequest()` / `logger()`** — request metadata and replay-aware
  logging.
- **`contextLocal<T>(default?)`** — in-memory, invocation-scoped ambient data.
  It is shared by fibers and is not durable state.

### Combinators and routines

- **`all(futures)`** — all values, in input order.
- **`race(futures)`** — first Future to settle.
- **`any(futures)`** — first Future to succeed; throws `AggregateError` if all
  fail.
- **`allSettled(futures)`** — all outcomes without throwing.
- **`select({ tag: future, ... })`** — first outcome plus a discriminating tag.
- **`spawn(op)`** — start a multi-step child routine; returns a `Task<T>`.
- **`task.interrupt(err?)`** — interrupt a task and its spawn subtree at their
  next yield points.
- **`channel<T>()`** — single-shot, in-memory communication between routines in
  the same invocation.

Combinators use the core SDK's Restate promise combinators when every input is
journal-backed and otherwise coordinate through the Gen scheduler. User-facing
semantics are the same in either case.

## Main-operation lifetime and cancellation

By default, `execute` resolves as soon as its main operation settles. Spawned
fibers and race losers still running at that moment are **abandoned**: they are
not resumed, their `catch`/`finally` blocks do not run, and their parked sources
are dropped. Work already journaled remains durable.

Use `{ onMainExit: "join" }` as the third argument to `execute` to keep driving
until every spawned fiber finishes. A never-settling child will then keep the
handler alive, so prefer explicitly yielding tasks whose completion matters.

Invocation cancellation arrives as `CancelledError` (a `TerminalError`
subclass) at the next `yield*` boundary. Each `run` closure also receives an
AbortSignal that aborts first, allowing in-flight HTTP or database requests to
stop promptly. Catch cancellation only when cleanup is required and normally
rethrow it afterward.

For routine-level stop, use `task.interrupt(err?)` or a `Channel<void>` plus
`select({ work, stop: stop.receive })` for cooperative shutdown. If cleanup in
an interrupted task must run under the default abandon policy, interrupt and
then `yield*` the task.

## Ingress client

Outside a Restate handler, use the `clients` namespace with the same definition
that hosts the service:

```ts
import { clients } from "@restatedev/restate-sdk-gen";
import { greeter } from "./greeter.js";

const ingress = clients.connect({ url: "http://localhost:8080" });
const greeting = await clients.client(ingress, greeter).greet("Sam");
```

- `clients.client(ingress, def, key?)` — typed request/response client.
- `clients.sendClient(ingress, def, key?)` — fire-and-forget client.
- `clients.scope(ingress, scopeKey)` — scoped typed clients.
- `clients.Opts.from(...)` / `clients.SendOpts.from(...)` — per-call options.

### Automatic retries

Ingress retries are opt-in and configured connection-wide:

```ts
const ingress = clients.connect({
  url: "http://localhost:8080",
  retry: {
    maxAttempts: 6,
    initialInterval: { milliseconds: 100 },
    maxInterval: { seconds: 2 },
  },
});

await clients.client(ingress, greeter).greet(
  "Sam",
  clients.Opts.from({ idempotencyKey: "greet-sam-once" })
);
```

When enabled, the client retries network errors, HTTP `429`, and HTTP `5xx`
with exponential backoff and jitter—but only when the call has an
`idempotencyKey`. Restate deduplicates on that key, so a retry attaches to the
same invocation rather than starting a duplicate. Without a key, no automatic
retry is attempted.

`shouldRetry` replaces the built-in rule. Compose it with
`clients.defaultShouldRetry` when you only want to narrow the defaults. See
`examples/tutorial/src/13-ingress.ts` for a runnable example.

## Repository layout

```text
packages/libs/restate-sdk-gen/
├── src/                # published library
├── test/               # Vitest unit tests
├── bench/              # microbenchmarks
├── examples/tutorial/  # runnable, topic-based tutorial
├── e2e/                # Testcontainers end-to-end tests
└── test-services/      # sdk-test-suite endpoint service
```

Only `dist/` and `README.md` are published to npm. The longer guide and runnable
tutorial live in the source repository.

## Development

From the workspace root:

```bash
pnpm install
pnpm --filter @restatedev/restate-sdk-gen _test
pnpm --filter @restatedev/restate-sdk-gen _build
pnpm --filter @restatedev/restate-sdk-gen test:e2e        # Docker required
pnpm --filter @restatedev/restate-sdk-gen start:tutorial
pnpm --filter @restatedev/restate-sdk-gen bench
```

Read [`guide.md`](./guide.md) for the full user guide,
[`DESIGN.md`](./DESIGN.md) for architecture, and
[`BENCHMARKS.md`](./BENCHMARKS.md) for benchmark interpretation.
