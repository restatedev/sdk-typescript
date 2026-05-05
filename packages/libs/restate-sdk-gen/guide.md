# restate-fluent — User Guide

A pattern-by-pattern guide to writing workflows. Read alongside `DESIGN.md`,
which covers the model and semantics. This document focuses on shapes of
code you'll actually write.

The examples use the **free-standing API** — `sleep`, `run`, `all`,
`select`, etc. imported directly. Inside a `gen(function*() { ... })`
body these read the active scheduler from a synchronous current-fiber
slot set by `execute()`; you don't pass `ops` around.

---

## Hello, world

```ts
import * as restate from "@restatedev/restate-sdk";
import { gen, execute, run } from "@restatedev/restate-sdk-gen";

const greeter = restate.service({
  name: "greeter",
  handlers: {
    greet: async (ctx, name: string) =>
      execute(
        ctx,
        gen(function* () {
          const greeting = yield* run(async () => {
            return `Hello, ${name}!`;
          }, { name: "compose" });
          return greeting;
        })
      ),
  },
});

restate.serve({ services: [greeter] });
```

Three things to notice:

- The handler is a normal `async (ctx, ...) => ...` function. We call
  `execute(ctx, ...)` inside it; everything generator-y is inside that
  call.
- `execute` takes an `Operation<T>` directly — typically the result of
  `gen(function*() { ... })`. The free functions inside the generator
  body resolve the active scheduler implicitly; no `ops` parameter, no
  builder wrapper.
- The generator returns the value the handler should return.

The rest of this guide assumes you're inside `gen(function*() { ... })`
with the free functions in scope.

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

Each `run` is a separately journaled entry, so make sure the names are
unique within the workflow.

### "Whichever finishes first"

```ts
const winner = yield* race([
  run(() => fetchPrimary(), { name: "primary" }),
  run(() => fetchSecondary(), { name: "secondary" }),
]);
return winner;
```

The losing call keeps running in the background; its result is
discarded. If you need the result of the loser too, use `all` instead.

### "First one that succeeds, retry-style"

```ts
const winner = yield* any([
  run("region-a", () => callA()),
  run("region-b", () => callB()),
  run("region-c", () => callC()),
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
  run("a", () => fetchA()),
  run("b", () => fetchB()),
  run("c", () => fetchC()),
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
Yields a `Future<T>` that settles when the routine returns or throws.

```ts
const t1 = yield* spawn(workflowA);
const t2 = yield* spawn(workflowB);
// Both are running in parallel now.
const a = yield* t1;
const b = yield* t2;
```

Spawn vs. `all`/`race` of journal entries:

- **Use `run` + combinators** when you have a flat set of side
  effects. One journal entry per piece of work.
- **Use `spawn`** when each unit is itself a multi-step workflow with
  internal logic, branches, retries, etc.

To stop a spawned routine before it finishes, pass it a `Channel<void>`
and have it `select` over its work and `stop.receive` — see the
cooperative-cancellation section below. There is no `Future.cancel()`
primitive on spawned routines by design; cooperative stop is the
supported pattern.

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

The slow call keeps running in the background after timeout. Its result
is discarded; if it eventually completes, the entry is recorded but no
one reads it.

If you need to actually cancel the slow call (not just stop waiting),
pass an AbortSignal-aware closure to `run` — the closure receives
`{ signal }` and can wire it into `fetch` (or anything else that
accepts an AbortSignal). The signal aborts when invocation cancellation
arrives. For workflow-internal "stop on timeout," spawn the work as a
routine and signal it via a `Channel<void>` (see below).

---

## Retries

The SDK's `ctx.run` already handles retry internally — by default, it
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
const t = yield* spawn(workerOp(stop));
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
const tasks = workers.map(w => yield* spawn(workerOp(stop, w)));
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
Restate UI, or a parent invocation cancels you), the cancellation
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

## Two kinds of cancellation

Two distinct mechanisms, both valid:

| Mechanism | Initiator | How it surfaces | Scope |
|-----------|-----------|-----------------|-------|
| Invocation cancel | external (Restate UI, parent invocation) | `CancelledError` thrown at the next yield | every routine in the workflow |
| Cooperative stop | inside the workflow | `select` branch wins on `stop.receive` | one routine — the one selecting on the stop channel |

Invocation cancel is forced — the workflow is being torn down. Cooperative
stop is in-band: no exception, no forced unwind, the receiver decides
what to do (return partial results, run cleanup yields, ignore).

The two compose. A routine that selects on a stop channel can also catch
`CancelledError` for end-of-life cleanup if the whole invocation gets
cancelled out from under it.

There is no per-routine "kill this Future" primitive — by design. If you
control both sides, use cooperative stop. If you don't (you're running
someone else's Operation), the choice is to wrap it in a supervising
routine that `select`s against a stop channel, or accept that it'll run
to completion and discard the result.

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

### Race losers continue running

```ts
const winner = yield* race([
  run(() => slowA(), { name: "a" }),
  run(() => slowB(), { name: "b" }),
]);
// If a wins, b's closure is still running. Its result is journaled but
// nobody reads it. If you spawned b as a routine and want to cancel
// it, that's separate.
```

The scheduler waits for *every* spawned routine to finish before
returning. This means race losers must terminate on their own; the
scheduler doesn't kill them. In practice this is rarely an issue
because journal-backed work always terminates (the underlying RPC or
sleep settles eventually). But if you spawn a routine with an infinite
loop and race it against something, your handler will hang forever.

---

## Common gotchas

### Don't reuse a generator instance

```ts
// WRONG
const g = myWorkflow();
yield* spawn(g);
yield* spawn(g); // generator is exhausted, second spawn does nothing
```

`gen()` takes a *factory function*. Pass the factory, not the
generator:

```ts
const myWorkflow = (): Operation<string> =>
  gen(function* () {
    // ...
  });

yield* spawn(myWorkflow());
yield* spawn(myWorkflow()); // fresh generator
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

On replay, journal entry names must match the original execution. The
closure's body can do anything — it's only re-run if the entry isn't
in the journal — but the *name* must be reproducible.

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
    // log it, return a default, etc. — but be sure
  }
  // retryable error: maybe retry
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
Error: restate-fluent: free-standing API called outside an active fiber.
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
| Pass an event from outside | channel — `send` from outside, `receive` inside |

---

## Where to look next

- `DESIGN.md` — the model, semantics, and the why behind decisions.
- `examples/` — runnable services (`tutorial/`).
- `packages/restate-fluent/test/workflow-patterns.test.ts` — full
  implementations of retry, saga, polling, work-stealing, and more.
- `packages/restate-fluent/test/cancellation.test.ts` and
  `abort-signal.test.ts` — every cancellation behavior tested explicitly.
- `packages/restate-fluent/test/channel.test.ts` — channel patterns
  including the cooperative-cancellation idiom.
