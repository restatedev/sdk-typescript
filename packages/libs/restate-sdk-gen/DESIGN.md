# restate-fluent

A generator-based DSL for writing Restate workflows. Two user-visible
types, four combinators, and a small set of semantics rules. This
document describes how it works and how to use it.

---

## Why this exists

Restate workflows in TypeScript are normally written as `async`
functions that `await` `RestatePromise`s. The model is fine for simple
workflows but gets awkward as concurrency patterns multiply: spawning
sub-tasks, racing futures, selecting on the first to fire, composing
combinators. Writing these patterns directly against `RestatePromise`
mixes two concerns — what your workflow does, and how the runtime
should drive it.

`restate-fluent` separates them. You write workflow logic as generators
that yield descriptions of work; a small scheduler drives the
generators against the Restate runtime. The result reads like
straight-line code but composes cleanly across concurrent tasks.

---

## The model: Operations and Futures

Two types do all the work.

**`Operation<T>`** is a *description* of work that produces a `T`. It's
lazy and one-shot: nothing happens until something runs it, and each
run consumes the description independently.

**`Future<T>`** is a *handle* to work that's already started. It's
eager and memoized: the work runs once, and yielding the future
multiple times gives you the same `T` each time.

The reason for the split is that Restate has two kinds of work the
runtime cares about — journal entries and concurrent tasks — and they
need different abstractions:

- A **journal-backed Future** wraps a `RestatePromise` from the SDK
  (`ctx.run(...)`, `ctx.sleep(...)`, `ctx.awakeable()`, etc.). The
  runtime records and replays it; the Future is just a handle.
- A **routine-backed Future** is an Operation that has been spawned as
  a concurrent task. The scheduler drives it; the Future is the handle
  to its eventual result.

Users can't tell which backing a Future has, and shouldn't need to.
Combinators inspect the backings internally to pick the cheapest
implementation, but the semantics are the same regardless.

You write Operations with `gen()`:

```ts
import { gen } from "@restatedev/restate-sdk-gen";

const myWorkflow = (ops) =>
  gen(function*(): Generator<unknown, string, unknown> {
    const a = yield* ops.run("step-a", () => fetch("/a"));
    const b = yield* ops.run("step-b", () => fetch("/b"));
    return `${a}-${b}`;
  });
```

`gen` takes a *factory function* — `() => Generator<...>` — not a
generator instance. This isn't cosmetic: it forces a fresh generator
on every run, which closes off a class of bugs where reusing an
already-consumed generator silently produces empty results. Passing a
bare generator (`gen(myFn())`) doesn't typecheck.

You yield a Future to wait for it. `yield* future` returns the value
when the future settles, or throws if it rejected. Futures can be
yielded repeatedly with the same result.

You spawn an Operation with `ops.spawn`:

```ts
const f = yield* ops.spawn(myWorkflow);  // f: Future<...>
// ... do other things ...
const result = yield* f;
```

---

## Combinators

Six combinators, in `ops`. The four Promise-shaped ones mirror
`RestatePromise.all/race/any/allSettled` (semantics matching the native
`Promise.*`); `select` is the tagged variant of `race`; `spawn` is the
routine-construction primitive.

**`all(futures)`** — wait for all futures to settle, return values in
input order. Throws if any future rejects.

**`race(futures)`** — wait for the first future to settle, return its
value (or throw if it rejected). Other futures keep running in the
background; their results are not delivered.

**`any(futures)`** — wait for the first future that *succeeds*
(non-rejected), return its value. If every future rejects, throws
`AggregateError(errors)` with errors in input order. Empty input is
the all-rejected case.

**`allSettled(futures)`** — wait for every future to settle, return an
array of `FutureSettledResult` (`{status:"fulfilled", value}` or
`{status:"rejected", reason: unknown}`) in input order. Never rejects.

**`select(branches)`** — wait for the first branch to settle, return
`{ tag, future }` of the winner. The user switches on `tag` and
optionally unwraps `future` to get the value. Unlike `race`, `select`
returns the future itself rather than the value, which is useful in
loops where you want to inspect what won without unwrapping.

```ts
const r = yield* ops.select({
  done: longRunningTask,
  tick: ops.sleep({ seconds: 1 }),
});
switch (r.tag) {
  case "done": return yield* r.future;
  case "tick": /* periodic work */; break;
}
```

**`spawn(op)`** — register an Operation as a concurrent routine,
return its Future.

### Composition rules

Combinators take and return Futures. They compose freely: `all` of
`race`s, `race` of `all`s, `select` over combinator results,
combinators inside spawned routines, etc.

When every input to `all`/`race`/`any`/`allSettled` is journal-backed,
the implementation collapses to a single `RestatePromise.all/race/any/
allSettled` call — one journal combinator entry. When any input is
routine-backed, the implementation falls back to a synthesized fiber
that yields each future in turn (or for `any`, loops over `awaitRace`
collecting rejections). Either way the semantics are identical; the
fast path is just an optimization.

A few rules worth internalizing:

- **`all` over an empty array** returns `[]` immediately. `any` over
  an empty array rejects with `AggregateError([])`. `allSettled` over
  an empty array returns `[]`.
- **A Future appearing twice in the inputs** of any combinator is
  fine. It's the same handle; it settles once; both positions deliver
  the same value.
- **`select` on a future that's already settled** wins immediately.
  This means `while(true) yield* select({a: f, b: f})` over a settled
  `f` is a hot loop. The pattern is: structure your select to always
  have at least one branch that will produce a fresh future per
  iteration, and break out on the terminal branches. If you do that,
  there's no hot loop.
- **Sequential `all` over deferred work resolves in input order**
  even if the underlying journal entries settle in arbitrary order.

---

## Concurrency: spawning, racing, and what happens to losers

Spawning a routine starts it running. The runtime drives the routine
forward whenever it has work to do (a journal source resolves, a child
finishes). The routine's Future settles when the routine returns.

The important property is what happens to *losers* of a `race`. A
race returns the winner's value to your code, but the losing routines
keep running. They don't get cancelled. Their results are delivered to
their own Futures, which nobody is awaiting; if nobody ever yields
those Futures again, the values are dropped on the floor.

This is intentional. The losing routine has a Future; it's still a
first-class handle. You can yield it later if you want both results,
hand it off to another routine, or ignore it. The system shouldn't
make that choice for you. Cancellation, when you want it, is what
you'd reach for — but cancellation in this system means something
specific (see below) and isn't the right tool for "stop work I'm no
longer interested in."

The practical consequence: `Scheduler.run(op)` doesn't return until
*every* spawned routine has finished. If a race loser is parked on a
journal source that never resolves, `run` doesn't return. In tests
this means resolving every deferred you constructed; in production it
means designing your routines to terminate even if their results are
unused.

---

## Cancellation

External cancellation — someone clicks "cancel workflow" in the UI, or
a parent invocation cancels a child — arrives at the workflow as a
TerminalError thrown at the next await point. The system has one
central await point: the scheduler's main loop. So cancellation is
observed in one place and propagated to user code uniformly.

### How it works

The Restate SDK's default behavior, by spec: when invocation
cancellation arrives, the next `await` on a `RestatePromise` (or
`RestatePromise.race`) rejects with `TerminalError`. The underlying
promise objects aren't poisoned — only the awaited *result* is. A
fresh await afterward gets normal behavior unless cancellation arrives
again.

The scheduler's main loop awaits `RestatePromise.race(taggedSources)`
where each source is one parked routine's pending journal work. When
cancellation arrives, that race settles with a TerminalError
rejection. The scheduler catches it, then *fans out* the same
TerminalError to every routine that had a source in the race. Each
routine wakes at its current yield point with the error thrown.

This is the entire mechanism. There is no cancellation flag, no opt-in,
no "in cancellation mode" state. Each main-loop iteration constructs a
fresh race promise; if the SDK cancels it, we propagate; if not, we
proceed normally.

### What user code sees

```ts
gen(function*() {
  try {
    const result = yield* ops.run("step", () => doWork());
    return result;
  } catch (e) {
    // TerminalError caught here. The error type is the SDK's
    // CancelledError (a TerminalError subclass).
    cleanup();  // pure JS — runs normally
    throw e;    // propagate, or return a fallback value, or
                // recover by yielding more journal work.
  }
});
```

Cancellation is **not sticky**. After the catch, the next yield runs
normally — the underlying journal sources are still pending and will
settle however they would have. If a *second* cancellation arrives
later, that one rejects the next race in the same way. Each cancel is
a separate, independent event.

This is the single most important property of the design. It means:

- Cleanup that yields journal ops (`yield* ops.run("audit", ...)`)
  just works.
- A routine can catch cancellation, decide not to honor it, and return
  a value. The journal records that value. The routine completes
  normally.
- Multiple sequential cancellations are each delivered to the next
  yield boundary, independently.

### Fan-out across concurrent routines

If three routines are parked when cancellation fires, all three wake
with TerminalError. They can each decide independently whether to
catch, propagate, or recover. The fan-out happens at the scheduler
level — every parked source's `fire` callback receives the
TerminalError, which means routines parked on AwaitAny over multiple
sources also see the cancellation correctly (the won-flag ensures only
one wake per routine).

### The AbortSignal

Each `ops.run` closure receives `{ signal }` — an `AbortSignal` that
fires when the scheduler observes cancellation. Pass it into
AbortSignal-aware APIs:

```ts
yield* ops.run("fetch-user", async ({ signal }) => {
  const res = await fetch(`/users/${id}`, { signal });
  return res.json();
});
```

When cancellation arrives, the in-flight fetch is aborted. The routine
wakes with TerminalError at the yield site (as always). Without the
signal plumbing, the fetch would complete naturally (its result
discarded by the cancelled routine) — wasting work and network. With
the signal, it cancels promptly.

The scheduler's signal is intentionally not exposed as a property of
`ops`. Cancellation surfaces in workflow code through two channels:

- `TerminalError` thrown at the next yield (from `yield* future`),
- the `{ signal }` arg available inside `ops.run` closures.

That's it. There's deliberately no `ops.abortSignal` — broader signal
access would invite "query the signal in pure-JS sections" patterns
that conflate scheduler state with workflow control flow.

Timing: the scheduler aborts the signal *before* fanning out the
TerminalError to routines. So in-flight syscalls start cancelling at
the earliest possible moment, slightly before user catch handlers
run. The order is microseconds different from any user-observable
behavior, but it minimizes wasted work.

### Cancellation hygiene in `ops.run`

`ops.run` wraps user closures with cancellation-aware error handling.
On the throw path, if the signal aborted during execution, the wrapper
rethrows `signal.reason` (a TerminalError) instead of whatever the
closure threw. This ensures the journal records a *terminal*
cancellation rather than a non-terminal AbortError, which Restate
would otherwise treat as retryable.

Concretely:

- Closure throws AbortError after abort → wrapper rethrows the
  TerminalError reason.
- Closure throws an unrelated error after abort → wrapper rethrows the
  TerminalError reason. (Over-conversion, but harmless: the routine
  sees TerminalError at its yield anyway, and the journal outcome —
  cancellation — is what's actually happening.)
- Closure throws before abort fires → original error propagates as
  itself. Real validation failures are not shadowed.
- Closure catches abort internally and returns a value → wrapper
  doesn't intervene. The journal records the returned value. The
  routine still sees TerminalError at its next yield.

The "closure catches and returns" path is the one case where
information is lost from the journal's perspective: the closure's
deliberate choice to handle the abort and produce a value is recorded
as success. This is by design. If you need to record a cancellation
even though the closure handled it gracefully, throw a TerminalError
explicitly.

### Recovery and journal safety

A routine that catches TerminalError and yields more work (`ops.run`,
`ops.sleep`, etc.) executes those normally. Each yield is a fresh
journal entry recorded with the corresponding outcome.

If cancellation arrives a second time while the routine is doing
cleanup, the second cancellation is delivered to the routine's next
yield. The routine can catch and recover again, or propagate.

There is no built-in "cleanup mode" that suppresses cancellation
during finally blocks. If you need cleanup that's resilient to
re-cancellation, write it explicitly with try/catch around each yield
in the cleanup path.

---

## What's deliberately not in the design

A few features that come up in cancellation discussions and aren't
here, with the reasoning:

**No `Future.cancel()` per-routine.** Cancellation in this system is
an invocation-level event delivered by the SDK. We don't expose a way
to cancel an individual spawned routine. If you need to stop a single
sub-task, that's a different operation — currently best modeled as
"don't await its Future and let it complete on its own time." If
genuine per-routine cancellation becomes necessary, it will be a
separate primitive with its own design.

**No automatic propagation of cancellation across structured
concurrency.** Cancellation arrives at every parked routine
simultaneously via the fan-out, but if a parent catches and continues,
its children are unaffected — they each got their own cancellation
delivery and made their own choices. There's no "cancel children when
parent dies" link. Structured-concurrency patterns can be built on top
if desired.

**No retry/timeout combinators.** Retry-with-backoff and
timeout-with-fallback are user code, not primitives. The combinators
we provide (`spawn`, `all`, `race`, `any`, `allSettled`, `select`) compose to express
both cleanly. See the `workflow-patterns.test.ts` file for canonical
implementations.

---

## How to test workflow code

The scheduler is decoupled from the Restate SDK via a tiny
`Awaitable<T>` interface (a `PromiseLike<T>` plus a `.map((v, e) => U)`
projection). Production wires this to `RestatePromise`; tests wire it
to a hand-controlled promise.

`Scheduler.makeJournalFuture(awaitable)` lets you construct
journal-backed Futures from any awaitable, not just real
RestatePromises. Combined with the test substrate's `deferred()`,
`resolved()`, `rejected()`, this lets you write fast, deterministic
tests of workflow logic without booting Restate:

```ts
import { Scheduler, gen } from "@restatedev/restate-sdk-gen";
import { testLib, deferred } from "./test-promise";

test("my workflow", async () => {
  const sched = new Scheduler(testLib);
  const d = deferred<string>();
  const op = gen(function*() {
    return yield* sched.makeJournalFuture(d.promise);
  });
  const result = sched.run(op);
  d.resolve("hello");
  expect(await result).toBe("hello");
});
```

For cancellation tests, `cancellingLib()` returns a lib + a `cancel()`
function that mirrors the SDK's behavior — the next race promise
rejects with the given error, individual sources are unaffected.

The test suite exercises ~200 scenarios across journal/routine
combinations, deep nested combinators, cancellation propagation,
recovery patterns, and stress tests with thousands of concurrent
routines. Patterns that compose are tested at multiple levels (unit
combinator, mixed sources, deep trees, real workflow shapes), so
regressions in scheduler internals show up quickly.

---

## Production setup

```ts
import * as restate from "@restatedev/restate-sdk";
import { gen, execute } from "@restatedev/restate-sdk-gen";

const greeter = restate.service({
  name: "greeter",
  handlers: {
    greet: async (ctx, name) =>
      execute(ctx, (ops) =>
        gen(function*(): Generator<unknown, string, unknown> {
          const greeting = yield* ops.run("compose", async ({ signal }) => {
            const res = await fetch(`/translate?text=Hello+${name}`, { signal });
            return res.text();
          });
          return greeting;
        })
      ),
  },
});

restate.serve({ services: [greeter] });
```

`execute(ctx, build)` constructs a Scheduler wired to the real SDK,
calls `build(ops)` to get the root Operation, and runs it. The result
is awaited and returned to the SDK as the handler's return value.

Note: `execute` uses the SDK's *default* cancellation mode
(`explicitCancellation: false`). This is the mode where the SDK rejects
race promises with TerminalError on cancellation, which is what our
scheduler relies on. Don't enable `explicitCancellation: true` on
services that use this scheduler — the cancellation path won't work.

---

## Summary of guarantees

- A Future yielded multiple times gives the same value each time.
- An Operation can be run any number of times; each run is independent.
- Combinator results don't depend on settle order, only on input order.
- Cancellation is observed at yield boundaries, never mid-statement.
- Cancellation is recoverable: catch the TerminalError, do anything
  including more journal work, return any value.
- The journal records cancellation as a terminal outcome
  (CancelledError, code 409). Restate doesn't retry it.
- An AbortSignal lets `ops.run` closures respond to cancellation
  promptly; the abort fires before user catch handlers run.
- Routine losers in a race continue running in the background; the
  scheduler waits for them to complete before returning.
