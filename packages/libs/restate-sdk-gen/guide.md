# Restate Gen SDK — User Guide

A pattern-by-pattern guide to building durable Restate services, virtual
objects, and workflows with `@restatedev/restate-sdk-gen`. It covers the code
you write in an application; [`DESIGN.md`](./DESIGN.md) covers scheduler
internals and design rationale.

The Gen SDK builds on `@restatedev/restate-sdk`. Restate still journals every
durable operation and replays completed results after a crash. The difference
is how handler code composes those operations: generator handlers use `yield*`
and work with `Operation<T>` and `Future<T>` instead of awaiting
`RestatePromise<T>` directly.

The examples use the **free-standing API** — `sleep`, `run`, `all`,
`select`, etc. imported directly. Inside a `gen(function*() { ... })`
body these read the active scheduler from a synchronous current-fiber
slot set by `execute()`; you don't pass an operations object around.

## Install and run

```bash
npm install @restatedev/restate-sdk @restatedev/restate-sdk-gen
```

`@restatedev/restate-sdk` is a peer dependency. Start the endpoint shown below,
then register and invoke it through a running Restate server:

```bash
restate deployments register http://localhost:9080
curl localhost:8080/Greeter/greet --json '"World"'
```

---

## Hello, world

```ts
import * as restate from "@restatedev/restate-sdk";
import { service, run } from "@restatedev/restate-sdk-gen";

const greeter = service({
  name: "Greeter",
  handlers: {
    *greet(name: string) {
      return yield* run(async () => `Hello, ${name}!`, { name: "compose" });
    },
  },
});

restate.serve({ services: [greeter] });
```

Four things to notice:

- `service(...)` turns generator methods into ordinary Restate handlers and is
  directly bindable by `restate.serve`.
- The handler input and return type become the typed client contract.
- `run` records an external side effect. On replay, Restate returns the recorded
  result without executing the closure again.
- The generator's return value is the handler response.

For existing core-SDK definitions, use `execute` explicitly:

```ts
import { execute, gen, run } from "@restatedev/restate-sdk-gen";

const handler = async (ctx: restate.Context, name: string) =>
  execute(
    ctx,
    gen(function* () {
      return yield* run(async () => `Hello, ${name}!`, { name: "compose" });
    })
  );
```

`execute(ctx, operation, options?)` creates the scheduler for one invocation.
The optional `onMainExit` policy is covered under “Race losers and spawn
lifetime.” Most applications should prefer the Gen SDK definition factories
and only use explicit `execute` when integrating with an existing core-SDK
handler.

The rest of this guide assumes you're inside `gen(function*() { ... })`
with the free functions in scope.

---

## The execution model

An `Operation<T>` is lazy generator work. Use `gen(function* () { ... })` when
you want a reusable helper or a child routine. Each call must create a fresh
Operation:

```ts
const prepareOrder = (id: string): Operation<Order> =>
  gen(function* () {
    return yield* run(() => loadOrder(id), { name: "load-order" });
  });
```

A `Future<T>` is eager and memoized. Durable primitives start when their Future
is created, not when it is first yielded. Yielding the same Future twice does
not repeat its work. Use the Gen SDK's `all`, `race`, `any`, `allSettled`, and
`select` rather than native Promise combinators to coordinate durable work.

Free-standing APIs read the active generator synchronously. Call them only in a
generator body—not at module initialization, in `setTimeout`, or inside a
`run` closure. A `run` closure may perform external I/O, but it must not call
Restate operations.

---

## Service types

The three definition factories produce normal Restate definitions, so they can
be passed directly to `restate.serve`.

### Service

A service is stateless from Restate's perspective. Invocations are independent
and can run concurrently:

```ts
import { service } from "@restatedev/restate-sdk-gen";

export const emails = service({
  name: "Emails",
  handlers: {
    *send(input: { to: string; body: string }) {
      // durable work
    },
  },
});
```

### Virtual object

A virtual object has an application-defined key. Calls to exclusive handlers
are serialized per key and may update durable state. Mark read-only handlers as
`shared` when they may run concurrently:

```ts
import { object, sharedState, state } from "@restatedev/restate-sdk-gen";

type AccountState = { balance: number };

export const account = object({
  name: "Account",
  handlers: {
    *deposit(amount: number) {
      const store = state<AccountState>();
      const balance = (yield* store.get("balance")) ?? 0;
      store.set("balance", balance + amount);
      return balance + amount;
    },
    *balance() {
      return (yield* sharedState<AccountState>().get("balance")) ?? 0;
    },
  },
  options: { handlers: { balance: { shared: true } } },
});
```

### Workflow

A workflow's `run` handler executes once for each workflow key. Other handlers
are shared and can inspect state or resolve a workflow promise while `run` is
waiting:

```ts
import { workflow, workflowPromise } from "@restatedev/restate-sdk-gen";

export const approval = workflow({
  name: "Approval",
  handlers: {
    *run(request: Request) {
      return yield* workflowPromise<string>("decision").get();
    },
    *approve(reason: string) {
      yield* workflowPromise<string>("decision").resolve(reason);
    },
  },
});
```

Call objects and workflows with a key:

```ts
yield* client(account, "account-123").deposit(50);
yield* client(approval, "request-456").run(request);
```

### Schemas, serdes, and handler options

Plain generator handlers use JSON serialization. Use `schemas` to validate
input and output with any Standard Schema implementation:

```ts
import { z } from "zod";
import { schemas, service } from "@restatedev/restate-sdk-gen";

const Input = z.object({ name: z.string() });
const Output = z.object({ greeting: z.string() });

const greeter = service({
  name: "Greeter",
  handlers: {
    greet: schemas({ input: Input, output: Output }, function* ({ name }) {
      return { greeting: `Hello, ${name}!` };
    }),
  },
});
```

Use `serdes({ input, output }, generator)` for explicit Restate serdes such as
`restate.serde.binary`. Service-wide options go in `options`; handler-specific
options go in `options.handlers[handlerName]`. Object handlers additionally
accept `shared`, and service/object/workflow handlers support the compatible
core-SDK options such as lazy state and timeouts.

### Separate interface and implementation

Use the `iface` namespace when callers should depend on a contract without
depending on its implementation:

```ts
import { iface, implement } from "@restatedev/restate-sdk-gen";

export const counterApi = iface.object("Counter", {
  add: iface.json<number, number>(),
  get: iface.json<void, number>(),
});

export const counter = implement(counterApi, {
  handlers: {
    *add(delta) { /* ... */ return delta; },
    *get() { /* ... */ return 0; },
  },
  options: { handlers: { get: { shared: true } } },
});
```

`iface.schemas` and `iface.serdes` carry validation and serialization metadata
through typed in-handler and ingress clients.

---

## Sequential work

```ts
const a = yield* run(() => fetch("/a").then(r => r.text()), { name: "step-a" });
const b = yield* run(() => fetch("/b").then(r => r.text()), { name: "step-b" });
return `${a}-${b}`;
```

Each `run` is a journal entry. On replay, the recorded outcomes are
returned without re-running the closures.

The closure receives `{ signal }` if you need it — pass it into
AbortSignal-aware APIs:

```ts
const data = yield* run(async ({ signal }) => {
  const r = await fetch(url, { signal });
  return r.json();
}, { name: "fetch" });
```

The signal aborts when invocation cancellation arrives, letting
in-flight syscalls cancel promptly.

---

## Concurrent work

### Two pieces of work in parallel

```ts
const aF = run(() => fetchA(), { name: "a" });
const bF = run(() => fetchB(), { name: "b" });
const [a, b] = yield* all([aF, bF]);
return `${a}-${b}`;
```

`run` returns a `Future<T>` immediately. The work starts as soon as the
future is constructed. `all` waits for all futures to settle and
returns values in input order.

### N pieces of work in parallel

```ts
const futures = items.map(item =>
  run(() => processItem(item), { name: `process-${item.id}` })
);
const results = yield* all(futures);
```

Each `run` is a separately journaled entry. Names should be stable and
descriptive; journal position, not global name uniqueness, identifies the step.

### "Whichever finishes first"

```ts
const winner = yield* race([
  run(() => fetchPrimary(), { name: "primary" }),
  run(() => fetchSecondary(), { name: "secondary" }),
]);
return winner;
```

The losing call keeps running while the handler is still live; its
result is discarded. Once the main operation settles, a loser still in
flight is abandoned (see "Race losers and spawn lifetime" below). If you
need the result of the loser too, use `all` instead.

### "First one that succeeds, retry-style"

```ts
const winner = yield* any([
  run(() => callA(), { name: "region-a" }),
  run(() => callB(), { name: "region-b" }),
  run(() => callC(), { name: "region-c" }),
]);
```

`any` returns the first *succeeded* value, ignoring rejections. If
every input rejects, it throws an `AggregateError(errors)` whose
`.errors` array preserves input order. Use this when you want
"whichever endpoint comes back successfully first" rather than
"whichever finishes first" (which is `race`'s job — `race` would
surface a rejection if the first to settle happens to fail).

### "Wait for all, even on failure"

```ts
const results = yield* allSettled([
  run(() => fetchA(), { name: "a" }),
  run(() => fetchB(), { name: "b" }),
  run(() => fetchC(), { name: "c" }),
]);
for (const r of results) {
  if (r.status === "fulfilled") emit(r.value);
  else log.warn("failed", r.reason);
}
```

`allSettled` never throws — every input ends up as either
`{status:"fulfilled", value}` or `{status:"rejected", reason}` in
input order. Useful for fan-out where you want partial success rather
than aborting on the first failure.

### Inspecting which one won

```ts
const r = yield* select({
  fast: run(() => fetchFast(), { name: "fast" }),
  slow: run(() => fetchSlow(), { name: "slow" }),
});
switch (r.tag) {
  case "fast": return `fast: ${yield* r.future}`;
  case "slow": return `slow: ${yield* r.future}`;
}
```

`select` is `race` plus a tag. The branch you switch on tells you which
fired; you unwrap with `yield* r.future` to get the value.

---

## Spawning concurrent routines

`spawn` registers an Operation as a separate concurrent routine.
Returns a `Task<T>` — a `Future<T>` that settles when the routine
returns or throws, plus `interrupt(err?)` (see "Interrupting a task").

```ts
const t1 = spawn(workflowA);
const t2 = spawn(workflowB);
// Both are running in parallel now.
const a = yield* t1;
const b = yield* t2;
```

Spawn vs. `all`/`race` of journal entries:

- **Use `run` + combinators** when you have a flat set of side
  effects. One journal entry per piece of work.
- **Use `spawn`** when each unit is itself a multi-step workflow with
  internal logic, branches, retries, etc.

A spawned routine's lifetime is bounded by the main operation. By
default (`onMainExit: "abandon"`), `execute` returns as soon as the main
operation settles, and any spawned routine still running at that point
is abandoned — never resumed, no `catch`/`finally` blocks run. So
fire-and-forget spawns are **not** guaranteed to complete: if you need a
spawned routine to finish, `yield*` its future before returning, or run
with `{ onMainExit: "join" }` (see "Race losers and spawn lifetime"
below).

To stop a spawned routine before it finishes you have two options: a
forceful `task.interrupt(err?)` (throws into the routine at its next
yield — see below), or a cooperative `Channel<void>` it `select`s over
alongside its work (see the cooperative-cancellation section). Reach for
interrupt when you want to stop a routine that is parked anywhere; reach
for a stop channel when the routine should decide *how* to wind down at
a known point.

---

## Interrupting a task

`task.interrupt(err?)` throws `err` into the spawned routine at its next
yield point, and aborts its in-flight `run` I/O. `err` is delivered
verbatim; omit it for a default `InterruptedError`. The routine's own
try/catch may catch and recover — interrupt is swallowable, like
invocation cancellation.

```ts
const worker = spawn(longJob());
const r = yield* select({
  done: worker,
  budget: sleep({ seconds: 30 }),
});
if (r.tag === "budget") {
  worker.interrupt(new Error("over budget"));
  yield* worker; // interrupt-then-join: drive the worker's finally
}
```

The interrupt-then-join in that example matters. Under the default
`onMainExit: "abandon"`, interrupting a routine and then *returning*
from the handler delivers nothing — the scheduler stops the moment the
main operation settles, so the routine is abandoned before it advances
and its `catch`/`finally` never run. To run a routine's cleanup, `yield*`
the task after interrupting it, so it is driven to completion first.
(Under `{ onMainExit: "join" }` the scheduler keeps driving regardless.)

This is the per-task counterpart to invocation cancellation: same
delivery (a throw at the next yield), but targeted at one routine with
an error you choose. The injected error propagates like any other —
pass a `TerminalError` if an uncaught interrupt should fail the
invocation; the default `InterruptedError` is a plain error, so an
uncaught one fails only that routine and surfaces wherever its Future is
awaited.

Interrupting a routine that has already finished is a no-op.

**Interrupt cascades down the spawn subtree.** Interrupting a task also
interrupts every routine that task spawned, transitively, with the same
error — so interrupting a parent tears down the whole subtree it rooted,
each routine getting the throw at its own next yield (and its own
in-flight `run` I/O aborted). Scope is by spawn lineage: a child counts
even if it was handed back to someone else. A routine unrelated to the
interrupted one (a sibling spawned elsewhere) is untouched. This is the
nursery/scope behavior — interrupt the root and the whole tree winds
down.

Because interrupt also aborts each interrupted routine's per-`run`
`AbortSignal`, an in-flight `run(({ signal }) => fetch(url, { signal }))`
anywhere in the subtree stops promptly — while routines outside the
subtree keep their I/O.

---

## Timeouts

```ts
const fastEnough = (): Operation<string> =>
  gen(function* () {
    const r = yield* select({
      done: run(() => slowCall(), { name: "call" }),
      timeout: sleep({ seconds: 5 }),
    });
    if (r.tag === "timeout") throw new Error("timed out");
    return yield* r.future;
  });
```

The slow call keeps running while the handler is still live after
timeout. Its result is discarded; if it completes before the main
operation settles, the entry is recorded but no one reads it. Once the
main operation settles, the abandoned-fiber rules apply (see "Race
losers and spawn lifetime").

This is a soft timeout: it stops waiting but does not cancel the losing `run`.
To abort in-flight I/O on an internal deadline, put the work in a spawned
routine, pass its `run` AbortSignal to the I/O API, and interrupt the task when
the timer wins. Then join the interrupted task if its cleanup must execute.

---

## Retries

The underlying Restate `ctx.run` already handles retry internally—by default, it
retries forever on non-terminal errors (with backoff), and it stops on
TerminalError. You usually don't need to write a retry loop yourself.

To bound retries, pass options as the second argument to `run`:

```ts
const data = yield* run(() => fetchUser(id), {
  name: "fetch-user",
  retry: {
    maxAttempts: 3,
    initialInterval: { milliseconds: 100 },
    // maxDuration: { seconds: 30 },  // alternative bound
  },
});
```

When the bound is hit, `run` throws a `TerminalError` wrapping the
original error message. Catch that if you want a fallback:

```ts
import { TerminalError } from "@restatedev/restate-sdk";

let data: User;
try {
  data = yield* run(() => fetchUser(id), { name: "fetch-user", retry: { maxAttempts: 3 } });
} catch (e) {
  if (e instanceof TerminalError) {
    data = defaultUser;
  } else {
    throw e;
  }
}
```

Two error-shape conventions worth knowing:

- **`TerminalError`** — thrown by your closure means "fatal, do not retry."
- **`RetryableError`** with `retryAfter` — useful for honoring HTTP
  `Retry-After` headers; the SDK respects the hint.

A user-written retry loop on top of `run` is rarely the right tool.
Use it only when you need control flow that the policy can't express
(e.g., switch to a different endpoint after N failures, or check
external state between attempts).

---

## Durable state

State belongs to a virtual-object or workflow key and survives across
invocations. Reads return Futures; writes are synchronous journal operations:

```ts
type CartState = {
  items: Item[];
  owner: string;
};

const store = state<CartState>();
const items = (yield* store.get("items")) ?? [];
store.set("items", [...items, nextItem]);
const keys = yield* store.keys();
store.clear("owner");
store.clearAll();
```

`state<T>()` exposes reads and writes and belongs in exclusive object handlers
or the workflow `run` handler. `sharedState<T>()` exposes only `get` and `keys`
for shared handlers. Omitting `T` gives an untyped store with string keys and
per-call value inference.

Do not use module globals as durable state. They are process-local, disappear
on restart, and can be observed by unrelated invocations.

---

## Calling other handlers

Pass a Gen definition or interface to `client` for a typed request/response
call. Services need no key; virtual objects and workflows do:

```ts
const greeting = yield* client(greeter).greet("Ada");
const count = yield* client(counter, "counter-1").add(1);
const result = yield* client(signup, "user-42").run(input);
```

Calls return `ClientFuture<T>`, which behaves like any other Future and also
exposes an `.invocation` Future:

```ts
const callFuture = client(worker).process(job);
const ref = yield* callFuture.invocation;
logger().info("started", ref.id);
const result = yield* callFuture;
```

Use `sendClient` for a send that does not wait for the handler result. The
returned Future resolves to an `InvocationReference` once the invocation is
accepted:

```ts
sendClient(audit).record(event); // dispatch and continue

const ref = yield* sendClient(worker).process(job);
ref.cancel();
```

An `InvocationReference<T>` provides:

- `id` — the invocation ID.
- `attach(serde?)` — a Future for the invocation result.
- `signal(name, serde?)` — a reference with synchronous `resolve` and `reject`.
- `cancel()` — cancel the invocation.

If you already have an ID, use `invocation<T>(id, { outputSerde })`,
`attach(id, serde)`, or `cancel(id)`. Use `call({...})` and `send({...})` for
string-based targets that have no imported descriptor; these accept the core
SDK's `GenericCall` and `GenericSend` shapes.

Call and send options use the core SDK's `Opts` and `SendOpts` wrappers:

```ts
yield* client(worker).process(
  job,
  restate.Opts.from({ idempotencyKey: `job-${job.id}` })
);

sendClient(worker).process(
  job,
  restate.SendOpts.from({ delay: { minutes: 5 } })
);
```

---

## External callbacks and invocation signals

### Awakeables

An awakeable creates a unique callback ID and a Future. Store or send the ID to
an external system inside a journaled `run`, then yield the Future:

```ts
const { id, promise } = awakeable<Review>();
yield* run(() => requestReview(id), { name: "request-review" });
const review = yield* promise;
```

Another handler can complete it with `resolveAwakeable(id, value)` or
`rejectAwakeable(id, reason)`. An external system can use Restate's awakeable
HTTP endpoint:

```bash
curl localhost:8080/restate/awakeables/$ID/resolve --json '{"approved":true}'
```

Awakeables are durable and cross invocation/process boundaries. In-memory
channels are not.

### Named signals

Use a named signal when the sender knows the target invocation ID and both
sides agree on a name:

```ts
// Receiver
const decision = yield* signal<Decision>("review");

// Sender, in another generator handler
invocation<DecisionResult>(invocationId)
  .signal<Decision>("review")
  .resolve({ approved: true });
```

Signals are durable inter-invocation messages. A `Channel<T>` is only for
communication among routines inside one `execute` call.

### Workflow promises

Workflow promises have a stable name within a workflow key. The `run` handler
can wait while another workflow handler resolves or rejects the promise:

```ts
const approval = workflowPromise<Decision>("approval");
const current = yield* approval.peek();
const decision = current ?? (yield* approval.get());

yield* approval.resolve({ approved: true });
// or: yield* approval.reject("request denied");
```

---

## Deterministic context helpers

Code outside `run` is replayed and must make the same durable decisions. Use
Restate's deterministic helpers for random values and time:

```ts
const requestId = rand().uuidv4();
const sample = rand().random();
const timestamp = yield* date().now();
const isoTimestamp = yield* date().toJSON();
```

Use `logger()` for replay-aware logging. `handlerRequest()` returns request
metadata including invocation ID, headers, target, idempotency key, scope,
limit key, and the object/workflow `key` when present:

```ts
const request = handlerRequest();
logger().info("handling", request.id, request.key);
```

Do not use `Date.now()`, `new Date()`, `Math.random()`, or random UUID APIs in
generator control flow. They are fine inside `run`, where the result is
journaled, but any value returned by `run` must be serializable by its selected
serde.

---

## Scoped calls

`scope(scopeKey)` returns typed `client` and `sendClient` factories that route
within a Restate scope. Scopes group target identities and allow server-side
concurrency or rate-limit rules—for example, limiting a third-party API wrapper
per tenant credential:

```ts
const checkout = yield* scope(tenantKey)
  .client(merchantService)
  .checkout(order);
```

The scope key must match `[a-zA-Z0-9_.-]` and be 1–36 characters. A per-call
`limitKey` may be supplied through `Opts`/`SendOpts` only within a scope. Scopes
depend on corresponding Restate Server flow-control support; check the server
documentation before enabling scoped routing in production. A complete example
is in `examples/tutorial/src/14-scopes.ts`.

---

## Calling from outside a handler

The `clients` namespace adapts the same definitions to the external ingress
client. These methods return native Promises because this code runs outside a
durable handler:

```ts
import { clients } from "@restatedev/restate-sdk-gen";
import { greeter } from "./greeter.js";

const ingress = clients.connect({ url: "http://localhost:8080" });
const greeting = await clients.client(ingress, greeter).greet("Ada");
await clients.sendClient(ingress, greeter).record("called");
```

Use `clients.client(ingress, definition, key)` for an object or workflow.
`clients.scope(ingress, scopeKey)` provides the same scoped client shape.
Per-call configuration uses `clients.Opts.from(...)` or
`clients.SendOpts.from(...)`.

Ingress retries are disabled by default. Set `retry: true` on `connect` for the
built-in policy or pass a `RetryPolicy`. Automatic retries occur only when the
call carries an idempotency key, because that key lets Restate attach a retry to
the same invocation safely:

```ts
const ingress = clients.connect({ url, retry: true });

await clients.client(ingress, greeter).greet(
  "Ada",
  clients.Opts.from({ idempotencyKey: "greet-ada-once" })
);
```

The built-in rule covers network failures, HTTP 429, and HTTP 5xx. A custom
`shouldRetry` replaces it; compose with `clients.defaultShouldRetry` to narrow
the defaults. See `examples/tutorial/src/13-ingress.ts`.

---

## Cooperative cancellation with channels

The natural way to express "stop this worker on demand."

```ts
function workerOp(stop: Channel<void>): Operation<string> {
  return gen(function* () {
    const collected: string[] = [];
    for (let i = 0; i < 10; i++) {
      const r = yield* select({
        done: run(() => doStep(i), { name: `step-${i}` }),
        stop: stop.receive,
      });
      if (r.tag === "stop") {
        return `stopped-after:${collected.join(",")}`;
      }
      collected.push(yield* r.future);
    }
    return `complete:${collected.join(",")}`;
  });
}

// Caller:
const stop = channel<void>();
const t = spawn(workerOp(stop));
// ... decide to stop ...
yield* stop.send();
const result = yield* t;
```

Why this works smoothly:

- `stop.receive` is the **same Future** on every access. After
  `yield* stop.send()`, that Future is settled forever — every
  subsequent select with `stop.receive` as a branch takes the stop
  branch immediately.
- The worker decides what "stop" means. It can clean up, return a
  partial result, or even ignore the stop and finish anyway.
- No exceptions are thrown. The signaling is in-band — just a Future
  that resolves.

`send` returns an Operation that you yield with `yield*`, the same as
`receive`. The yield-required form keeps channels intra-workflow by
construction — for external signalling (cross-handler, webhooks),
reach for `awakeable()` instead.

Channels are single-shot. `send` is idempotent; yielding it twice is
harmless. If you need a sequence of values (progress events, say),
that's a different primitive (see "What's not here" at the end).

### Multiple workers, one stop

```ts
const stop = channel<void>();
const tasks = workers.map(w => spawn(workerOp(stop, w)));
// ... later ...
yield* stop.send();
const results = yield* all(tasks);
```

All workers share the same `stop.receive` Future. One `send` settles it,
all of them observe the stop branch on their next select.

### Stop with a reason

```ts
type Stop = { reason: string };
const stop = channel<Stop>();
// ...
yield* stop.send({ reason: "user-cancelled" });
// in the worker:
if (r.tag === "stop") {
  const { reason } = yield* r.future;
  return `stopped:${reason}`;
}
```

Channels are typed; the value comes back through `yield* r.future`.

---

## Cancellation from outside the workflow

If the invocation itself is cancelled (someone clicks "cancel" in the
Restate UI, or another invocation cancels it), the cancellation
arrives at the next yield point as a `CancelledError`:

```ts
import { CancelledError } from "@restatedev/restate-sdk";

try {
  return yield* longCall;
} catch (e) {
  if (e instanceof CancelledError) {
    // The whole workflow is being torn down.
    yield* run(() => recordCancel(), { name: "audit-cancel" }); // cleanup yields work normally
    throw e; // propagate
  }
  throw e;
}
```

`run` closures inside the yielding routine receive an aborted
AbortSignal at the same time, letting in-flight fetch/etc. cancel
promptly.

Cancellation is **not sticky** — after the catch, subsequent yields
work normally. Cleanup that yields journal ops just works.

---

## Three kinds of stopping

Three distinct mechanisms are available:

| Mechanism | Initiator | How it surfaces | Scope |
|-----------|-----------|-----------------|-------|
| Invocation cancel | external (Restate UI or another invocation) | `CancelledError` thrown at the next yield | every routine in the invocation |
| Task interrupt | supervising routine | chosen error thrown at the next yield | task and its spawn subtree |
| Cooperative stop | routine in the same invocation | `select` branch wins on `stop.receive` | routines selecting on that channel |

Invocation cancellation and task interruption inject errors. Cooperative stop
is in-band: no exception or forced unwind, and the receiver decides what to do
(return partial results, run cleanup yields, or ignore it).

The two compose. A routine that selects on a stop channel can also catch
`CancelledError` for end-of-life cleanup if the whole invocation gets
cancelled out from under it.

If you control both sides, a channel often gives the clearest graceful-stop
protocol. Use `task.interrupt()` when a supervising routine must stop work that
may be parked anywhere, including an in-flight `run`.

---

## Saga-style compensation

```ts
const reserveAndCharge = (
  itemId: string,
  amount: number
): Operation<{ orderId: string }> =>
  gen(function* () {
    const reservation = yield* run(() =>
      reserveItem(itemId), { name: "reserve" });
    try {
      const charge = yield* run(() =>
        chargeCard(amount), { name: "charge" });
      const orderId = yield* run(() =>
        createOrder(reservation.id, charge.id), { name: "create-order" });
      return { orderId };
    } catch (e) {
      // Compensate: release the reservation, then propagate.
      yield* run(() => releaseItem(reservation.id), { name: "release" });
      throw e;
    }
  });
```

Each step is journaled; failure of any step triggers compensation. The
compensation steps are themselves journaled, so they survive
restart.

---

## Worker pool / fan-out

```ts
const processBatch = (items: Item[]): Operation<Result[]> =>
  gen(function* () {
    const futures = items.map((item, i) =>
      run(() => processItem(item), { name: `process-${i}` })
    );
    return (yield* all(futures)) as Result[];
  });
```

For bounded concurrency (process at most N at a time), you'd want a
semaphore-style primitive — not built in, but expressible with
channels or sequential batching:

```ts
// Process in chunks of 10.
const chunks = chunk(items, 10);
const out: Result[] = [];
for (const c of chunks) {
  const batch = yield* all(
    c.map((item, i) => run(() => processItem(item), { name: `process-${i}` }))
  );
  out.push(...batch);
}
return out;
```

---

## Periodic / polling work

```ts
const pollUntilReady = (jobId: string): Operation<JobStatus> =>
  gen(function* () {
    while (true) {
      const status = yield* run(() =>
        getStatus(jobId), { name: `poll-${Date.now()}` });
      if (status.state === "done") return status;
      if (status.state === "failed") {
        throw new Error(`job ${jobId} failed`);
      }
      yield* sleep({ seconds: 5 });
    }
  });
```

Watch out: `Date.now()` in the journal name is **non-deterministic**
and bad. Use a counter instead:

```ts
let attempt = 0;
while (true) {
  const status = yield* run(() =>
    getStatus(jobId), { name: `poll-${attempt++}` });
  // ...
}
```

The closure can use whatever it wants internally; only the `name`
argument needs to be deterministic.

### Polling with cancellation

```ts
const pollWithStop = (jobId: string, stop: Channel<void>): Operation<JobStatus | null> =>
  gen(function* () {
    let attempt = 0;
    while (true) {
      const r = yield* select({
        status: run(() => getStatus(jobId), { name: `poll-${attempt++}` }),
        stop: stop.receive,
      });
      if (r.tag === "stop") return null;
      const status = yield* r.future;
      if (status.state === "done") return status;
      if (status.state === "failed") throw new Error("failed");

      const sleepResult = yield* select({
        tick: sleep({ seconds: 5 }),
        stop: stop.receive,
      });
      if (sleepResult.tag === "stop") return null;
    }
  });
```

Both the poll and the sleep are interruptible. The `stop` channel's
receive Future is reused everywhere.

---

## Context-local storage

Sometimes a value is needed deep inside the call tree — a correlation
id, a tenant, a logging prefix — but threading it through every helper
as a parameter is noise. `contextLocal()` gives you an ambient slot:
set it once near the top, read it anywhere downstream.

```ts
import { contextLocal, gen, run, spawn } from "@restatedev/restate-sdk-gen";

// Define the slot once, at module scope — minting touches no fiber.
const requestId = contextLocal<string>();           // string | undefined
const tenant = contextLocal<string>("public");      // with a default

const auditedStep = (label: string) =>
  gen(function* () {
    // Reads the ambient slots — nothing passed them down.
    const line = `[req ${requestId.get()} | ${tenant.get()}] ${label}`;
    return yield* run(async () => line, { name: label });
  });

const handler = gen(function* () {
  requestId.set(yield* run(() => newRequestId(), { name: "reqid" }));
  const a = yield* auditedStep("validate");        // sees requestId
  const b = yield* spawn(auditedStep("notify"));    // so does a spawned routine
  return [a, b];
});
```

The slot is scoped to **one invocation** (`execute` call) and shared by
**every fiber under it** — the main routine, everything it `spawn`s, and
the combinator fallbacks. There is no per-routine isolation and no
inheritance: it is one bag for the whole invocation. Concurrent
invocations in the same process never see each other's bags.

`get()` returns the value last `set()` this invocation, or the default
passed to `contextLocal` (or `undefined` if none).

A few things to keep in mind:

- **It is in-memory, not durable.** The bag lives only for the
  invocation; it is never journaled. For values that must outlive the
  invocation (and be visible to later invocations of the same virtual
  object) use `state()` / `sharedState()` instead.
- **Set deterministically.** A value re-derived by deterministic
  workflow code survives replay/suspension unchanged (the body re-runs
  and re-`set`s it the same way). Don't stuff a raw `Date.now()` or an
  un-journaled network result into a slot any more than you would into a
  plain local — route it through `run` first.
- **Shared means shared.** Because the bag is global to the invocation,
  two concurrently-interleaving routines that write the *same* slot
  clobber each other (a reader sees whichever advanced last). That's
  fine for the common "set once, read everywhere" use; it just isn't
  per-strand scratch space.
- **Call from the body, not from a `run` closure.** `get`/`set` work on
  the fiber's synchronous span — directly in the generator body or a
  spawned routine's body. Calling them from inside a `run` action
  closure (or any async callback) runs off-advance and throws "outside
  an active fiber", just like any other free function. To capture a
  journaled value, set it in the body from the result:
  `slot.set(yield* run(() => fetchTenant(), { name: "tenant" }))`.

---

## Working with futures defensively

### Future yielded twice gives the same value

```ts
const f = run(() => compute(), { name: "compute" });
const a = yield* f;
const b = yield* f;
// a === b; the closure ran once, the value was memoized.
```

### Future yielded inside an all alongside another reference

```ts
const f = run(() => compute(), { name: "compute" });
const [a, b] = yield* all([f, f]);
// Same again: a === b.
```

### Race losers and spawn lifetime

```ts
const winner = yield* race([
  run(() => slowA(), { name: "a" }),
  run(() => slowB(), { name: "b" }),
]);
// If a wins, b's closure is still running while the handler is live.
// Its result is journaled but nobody reads it. If you spawned b as a
// routine and want to cancel it, that's separate.
```

What happens to losers (and to any other still-running spawned routine)
when the main operation settles is governed by the `onMainExit` option
on `execute`:

- **`"abandon"` (the default).** `execute` returns as soon as the main
  operation settles. Any spawned routine still running at that point is
  abandoned at its current suspension point: it is never resumed again,
  so its `catch`/`finally` blocks do not run, and the source it was
  parked on is dropped. The stop is *prompt* — nothing observable
  (journal writes, channel sends, side effects) happens after the main
  operation's outcome is decided. Durable work the routine already
  performed is journaled as usual; only the in-memory continuation is
  discarded.
- **`"join"`.** `execute` keeps driving until *every* routine has
  finished. This is the older "wait for all" behavior.

Under the default this means a race loser — or any fire-and-forget
spawn — is simply dropped once the main operation returns; it does not
have to terminate on its own. A routine parked on a source that never
settles no longer hangs the handler.

```ts
import { execute } from "@restatedev/restate-sdk-gen";

// Keep driving spawned routines to completion instead of abandoning them.
execute(ctx, op, { onMainExit: "join" });
```

The caveat lives entirely under `"join"`: there, a spawned routine
parked on a source that never settles (an infinite loop, an awakeable
that is never resolved) keeps the scheduler alive and the handler will
hang forever. Reach for `"join"` only when the workflow genuinely
relies on fire-and-forget routines completing, and make sure every such
routine terminates on its own.

---

## Common gotchas

### Don't reuse a generator instance

```ts
// WRONG
const g = myWorkflow();
spawn(g);
spawn(g); // generator is exhausted, second spawn does nothing
```

`gen()` takes a *factory function*. Pass the factory, not the
generator:

```ts
const myWorkflow = (): Operation<string> =>
  gen(function* () {
    // ...
  });

spawn(myWorkflow());
spawn(myWorkflow()); // fresh generator
```

The type system already enforces this — you can't pass a bare
generator to `gen`. But the spawn-twice case is what to watch for: each
spawn call needs a *fresh* Operation.

### Don't put non-determinism in journal entry names

```ts
// WRONG
yield* run(() => fetch(url), { name: `fetch-${Math.random()}` });

// WRONG
yield* run(() => fetch(url), { name: `fetch-${Date.now()}` });

// OK
yield* run(() => fetch(url), { name: "fetch" });

// OK if attempt is a deterministic counter
yield* run(() => fetch(url), { name: `fetch-attempt-${attempt}` });
```

On replay, journal entry names must match the original execution. The closure
may perform non-deterministic external work because Restate records its outcome,
but it must not call Restate APIs and its result must be serializable. The
*name* must be reproducible too.

### Don't catch and ignore TerminalErrors carelessly

```ts
// SUSPICIOUS
try {
  yield* somework;
} catch {
  // swallow
}
```

If `somework` failed with a `TerminalError`, that's an explicit "this
is fatal." If it failed with a `CancelledError`, the invocation is
being cancelled. Swallowing these usually masks real problems.

Catch by type:

```ts
import { TerminalError, CancelledError } from "@restatedev/restate-sdk";

try {
  yield* somework;
} catch (e) {
  if (e instanceof CancelledError) throw e; // never swallow
  if (e instanceof TerminalError) {
    // Deliberately log it, return a fallback, or compensate.
  } else {
    throw e;
  }
}
```

### Don't reach for AbortSignal when a channel works

If you have control over the cancellee, give it a channel and let it
select on the stop branch. Cleaner code, clearer semantics.

AbortSignal is for the boundary case: you're calling a third-party API
that wants a signal, or you want to abort an in-flight syscall when
the surrounding routine is cancelled.

### Don't forget that `run` closures continue past cancellation

When a routine's signal aborts, in-flight syscalls *can* cancel (if
they observe the signal), but the closure itself decides. A closure
that doesn't pass `signal` to anything will run to completion no
matter what:

```ts
yield* run(async () => {
  // 30 seconds of CPU work; ignores any abort
  return heavyComputation();
}, { name: "oblivious" });
```

Cancellation arrives at the *yield site*, but the closure has already
returned (or hasn't yet). You'd see TerminalError after the
computation completes. To make this responsive, plumb the signal
through:

```ts
yield* run(async ({ signal }) => {
  return heavyComputationWithSignal(signal);
}, { name: "responsive" });
```

### Don't call free functions outside an active fiber

The free functions (`sleep`, `run`, `all`, …) read the active
scheduler from a synchronous current-fiber slot. That slot is set
during `Fiber.advance` and cleared at its boundary. Calling a free
function outside that span — at module init, from a stale `run`
closure that resolved after the fiber returned, from a `setTimeout`
callback — throws:

```
Error: @restatedev/restate-sdk-gen: free-standing API called outside an active fiber.
```

Practically, this means: free functions go inside the
`gen(function*() { ... })` body. If you need to construct work
ahead of time, factor it as a generator factory:

```ts
const myWorkflow = (): Operation<string> =>
  gen(function* () {
    return yield* run(() => doStep(), { name: "step" });
  });
```

`myWorkflow()` is safe to call anywhere — it just builds an Operation;
no `run` is invoked until the iterator runs inside `execute()`.

---

## When to use what

| Want | Reach for |
|------|-----------|
| Sequential side effects | `yield* run(...)` in sequence |
| Parallel side effects, all results | `all([f1, f2, ...])` |
| Whichever finishes first | `race([...])` |
| First *successful* result | `any([...])` (throws AggregateError if all fail) |
| Wait for all, never throw | `allSettled([...])` |
| First to finish, plus tag | `select({...})` |
| Sub-workflow with internal logic | `spawn(op)` |
| Stop a sub-workflow you control | channel + select |
| Cancel an in-flight HTTP call | pass `signal` to `fetch` in `run` |
| React to invocation cancel | catch `CancelledError` at yield site |
| Pass a callback ID to an external system | `awakeable()` |
| Send to a known invocation by ID and name | `signal()` / `invocation(id).signal()` |
| Ambient value for this invocation | `contextLocal()` — set once, read anywhere |
| A value that must outlive the invocation | `state()` / `sharedState()` (durable) |

---

## Where to look next

- [`DESIGN.md`](./DESIGN.md) — the model, semantics, and design rationale.
- [`examples/tutorial/`](./examples/tutorial/) — runnable services and clients.
- [`test/workflow-patterns.test.ts`](./test/workflow-patterns.test.ts) — full
  implementations of retry, saga, polling, work-stealing, and more.
- [`test/cancellation.test.ts`](./test/cancellation.test.ts) and
  [`test/abort-signal.test.ts`](./test/abort-signal.test.ts) — cancellation
  behavior tested explicitly.
- [`test/channel.test.ts`](./test/channel.test.ts) — channel patterns
  including the cooperative-cancellation idiom.
