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

You spawn an Operation with `spawn(op)`:

```ts
const f = spawn(myWorkflow);  // f: Future<...>
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
value (or throw if it rejected). Other futures keep running while the
main operation is still in flight; their results are not delivered. If
they are still running when the main operation settles they are
abandoned (see *Concurrency* below).

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
keep running while the main operation is still in flight. They don't
get cancelled. Their results are delivered to their own Futures, which
nobody is awaiting; if nobody ever yields those Futures again, the
values are dropped on the floor.

This is intentional. The losing routine has a Future; it's still a
first-class handle. You can yield it later if you want both results,
hand it off to another routine, or ignore it. The system shouldn't
make that choice for you. Cancellation, when you want it, is what
you'd reach for — but cancellation in this system means something
specific (see below) and isn't the right tool for "stop work I'm no
longer interested in."

### When the main operation settles: `onMainExit`

The lifetime of every spawned routine is bounded by the *main*
operation — the one you handed to `execute`/`Scheduler.run`. What
happens to routines still running when the main operation settles is
governed by `onMainExit`, an option on `execute`/`Scheduler` with two
values:

- **`"abandon"` (the default).** `run(op)` returns as soon as the main
  fiber settles. Any spawned routine still running at that point is
  *abandoned* at its current suspension point: it is never resumed, so
  no `catch`/`finally` blocks run, and the journal sources it was
  parked on are dropped. The stop is *prompt* — the scheduler checks
  `mainExited()` not only in the main loop but in the middle of
  draining the ready queue, so nothing observable (journal writes,
  channel sends, side effects) happens after the main fiber's outcome
  is decided. Durable work a routine already performed is journaled as
  usual; only its in-memory continuation is discarded.
- **`"join"`.** `run(op)` keeps driving until *every* spawned routine
  has finished. This is the pre-`onMainExit` behavior.

The loop condition is `while (\!this.mainExited() && this.fibers.size >
0)`, where `mainExited()` is true only when `onMainExit === "abandon"`
and the main fiber is done. Under `"join"`, `mainExited()` is always
false, so the loop runs until no fiber is alive (the old condition).
Under `"abandon"`, the main fiber is a member of `fibers` while it is
alive, so the conjunction reduces to `\!main.isDone()`.

Why is `"abandon"` the default? Because the alternative is a footgun.
A spawned routine — a race loser, a fire-and-forget background task —
parked on a journal source that never resolves would otherwise keep
the handler alive forever. Under `"abandon"` the handler returns the
moment its own logic is done; routines whose results nobody is waiting
for can't strand the invocation. Abandoned routines get no
`catch`/`finally` because the scheduler that would have to resume them
to run those blocks has already stopped — there is no driver left, and
resuming them would by definition perform observable work *after* the
handler's outcome was decided, which prompt-stop forbids. If you need
finalization to run, the routine has to settle before the main
operation does.

The practical consequence: fire-and-forget spawns are **no longer
guaranteed to complete**. A routine you `spawn` but never `yield*` may
be abandoned before it finishes. If you rely on it completing, either
`yield*` its Future before returning from the main operation, or pass
`{ onMainExit: "join" }` to `execute`. Under `"abandon"` the
race-loser-hangs-the-handler footgun is gone: a loser parked on a
never-settling source is simply abandoned when the main operation
settles. Under `"join"` the old caveat still applies — a routine
parked on a source that never resolves keeps `run` from returning, so
design routines to terminate even when their results are unused (in
tests, resolve every deferred you constructed).

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

Cancellation is not the only trigger. Production `execute()` passes
the SDK's `ctx.request().attemptCompletedSignal` to the scheduler as
its *parent* signal, so the signal also fires when the current
*attempt* ends — suspension, stream close, or completion. Without the
link, a `run` closure still in flight when the attempt dies would keep
running detached, doing work nobody can journal. Every controller the
scheduler creates is born linked to the parent (subscribed with
`{ once, signal }` so retired controllers self-detach — no listener
accumulation across cancel/recover cycles). One asymmetry:
cancellation is recoverable, so each cancel event replaces the
controller with a fresh unaborted one; an ended attempt is not — once
the parent has fired, replacement controllers are born aborted.

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

## Interrupting a task

`spawn(op)` returns a `Task<T>` — a `Future<T>` (yieldable, composable
into `all`/`race`/… exactly like any Future) plus one control method,
`interrupt(err?)`. Combinator results (`race`, `all`, …) stay plain
`Future<T>`: their journal fast path has no fiber to target, and their
fallback runs SDK-authored loop code with no user try/catch.

`task.interrupt(err)` does two things:

- **Throws `err` into the routine at its next yield point.** This is the
  cancellation fan-out's mechanism, scoped to one fiber: `wake` the
  fiber with a failure resume, delivered as `it.throw(err)` when it next
  advances. `err` is thrown verbatim; the routine's own try/catch may
  catch and recover (interrupt is swallowable / non-sticky, like
  invocation cancellation). With no argument, a plain `InterruptedError`
  is thrown — a default sentinel, deliberately *not* a `TerminalError`
  subclass, so interrupt imposes no blast radius of its own. Pass a
  `TerminalError` if you want an uncaught interrupt to fail the
  invocation terminally; pass an error your routine recognizes if you
  want it to distinguish "I was interrupted" from "my work threw".
- **Aborts the routine's in-flight `run` I/O.** Each fiber lazily owns
  an `AbortController` whose signal is handed to its `run` closures.
  Interrupt aborts it, so an in-flight `run(({ signal }) => fetch(url, {
  signal }))` stops promptly instead of running on detached. The signal
  is a *child* of the scheduler signal, so invocation cancellation /
  attempt-end still cascade in; but interrupt aborts only the targeted
  fiber's signal, leaving siblings' in-flight I/O untouched. After a
  swallowed interrupt the controller is recreated, so a cleanup `run`
  sees a fresh, unaborted signal.

Semantics worth pinning down:

- **Done / consumed target** — no-op. A finished routine has no yield
  point left.
- **Double interrupt** before the next advance — last-write-wins, not
  queued.
- **Self-interrupt** — a routine interrupting its own task is uniform
  with interrupting any other: the throw lands at its next yield. The
  re-entrant `wake` fires during the routine's own step; `advance`
  detects the epoch bump and delivers the resume instead of parking on
  the op the body just yielded. If the body returns before reaching
  another yield, the self-interrupt is moot (no yield point to land on).
- **Same-tick precedence** — if the routine had already been woken with
  a value (its awaited source just settled) but hasn't advanced yet, the
  interrupt wins: the value the generator never observed is discarded.
- **`onMainExit` interaction** — under the default `"abandon"`,
  interrupting a child and then returning from the main operation
  delivers *nothing*: the scheduler stops the moment main settles, so
  the child is abandoned before it advances and no `catch`/`finally`
  runs. To run the child's cleanup, **interrupt then join** — `yield*`
  the task after interrupting, so it is driven to completion before main
  returns. (Under `"join"` the scheduler keeps driving regardless.)
- **Determinism** — interrupt is an in-memory control op issued from
  inside a fiber advance, so its delivery point is fixed by the same
  deterministic drive order as everything else; replay reproduces it.
  The signal-abort touches only live I/O (on replay, `run` closures
  don't re-execute), so it is replay-neutral.

### The epoch guard

**The invariant interrupt breaks.** Before interrupt, a parked fiber had
exactly one way to leave the `parked` state: one of the sources it was
parked on fires. A fiber parked on sibling `G` only ever woke when `G`
finished — so the thing that woke it *was* the thing it was waiting on,
and stale waiters were a non-problem. Interrupt violates this: it wakes
a fiber from the outside while the sources it registered are still live.
The fiber catches, re-parks elsewhere, and the callbacks it left on its
old targets are still armed.

**Why only local waiters are at risk.** The two kinds of source register
differently. *Journal* sources are re-collected fresh from each fiber's
`parkedSources()` on every main-loop tick, and a journal source's `fire`
is only ever invoked for the winner of the race it is part of — a race
built *after* the drain settles, so the owning fiber cannot have moved
on within that race. Stale journal fires can't happen; the journal-leaf
`fire` is therefore left unguarded. *Local* waiters are different:
`awaitCompletion` only ever pushes the callback onto the target's waiter
list, which is cleared (firing **all** of them) when the target itself
finishes. Nothing prunes a waiter when the *waiting* fiber moves on — so
a callback from a pre-interrupt park survives and fires whenever the
sibling/channel eventually settles, possibly many drains later.

The concrete failure, without a guard:

```
W parks on sibling G  →  W's callback is now in G's waiter list
interrupt(W)          →  W.wake(err): W goes ready, the callback untouched
W advances            →  catches err, re-parks on sibling H
G finishes later      →  fires all its waiters, incl. W's stale callback
                      →  W, currently parked on H, is woken with G's value
                         and its H-park is clobbered. Corruption.
```

**The mechanism.** Each fiber carries a monotonic park-`epoch`, bumped on
every `wake` — and `wake` is the single choke point through which a fiber
leaves `parked` (a source firing or an interrupt both route through it),
so bumping there retires the current park's waiters by construction
rather than by enumerating cases. Every waiter captures the epoch at
registration and no-ops on mismatch:

```
const epochAtPark = this.epoch;
target.awaitCompletion((s) => {
  if (this.epoch !== epochAtPark) return;   // stale → drop
  this.wake(s);
});
```

Replaying the failure with the guard: `W`'s callback captured epoch `E`;
the interrupt's `wake` moved `W` to `E+1`; when `G` later fires the
callback it sees `epoch (E+1) !== E` and drops. Epoch is monotonic and
compared for equality, so once a fiber moves past `epochAtPark` that
waiter is permanently dead — no resurrection.

**It subsumes the `won` flag.** The old per-`AwaitRace` `won` boolean did
*within-episode* dedup — when several race sources settle in the same
tick, only the first wakes the fiber. The epoch covers that for free: the
first source fires, `wake` bumps the epoch, and later same-tick fires see
a mismatch and drop. So one mechanism now handles both within-episode
dedup (what `won` did) and cross-episode staleness (what `won`, a fresh
closure per park, could not — and what interrupt needs). `won` was
removed entirely; `won-flag.test.ts` passing unchanged on the epoch guard
is the evidence the within-episode behavior is preserved.

This is what makes interrupt safe for a routine parked on *any* source —
including a purely local one (waiting on a sibling or a channel) that the
cancellation fan-out can't even reach, since such a fiber contributes no
journal source to the main-loop race.

---

## What's deliberately not in the design

A few features that come up in cancellation discussions and aren't
here, with the reasoning:

**Per-routine interrupt — `task.interrupt(err?)`.** Invocation-level
cancellation is a broadcast delivered by the SDK. To stop *one* spawned
routine, `spawn` returns a `Task<T>` (a `Future<T>` plus `interrupt`),
and `task.interrupt(err)` throws `err` into that routine at its next
yield point — a targeted, single-fiber instance of the same mechanism
the cancellation fan-out uses (`wake` with a failure resume, delivered
as `it.throw` at the yield). See *Interrupting a task* below.

If you only want to *forget* a sub-task rather than stop it, you still
can: don't await its Future, and under the default `"abandon"` policy
it is discarded when the main operation settles (see *Concurrency*
above), so you don't pay for work whose result you never read.

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

`execute` takes an optional third argument, `ExecuteOptions` (an alias
for `SchedulerOptions`), carrying the `onMainExit` policy described in
*Concurrency* above. By default (`"abandon"`) `execute` resolves as
soon as the main operation settles, abandoning any spawned routines
(and race losers) still running at that point; pass
`{ onMainExit: "join" }` to instead keep driving until every spawned
routine has finished. `execute`, `ExecuteOptions`, `OnMainExit`, and
`SchedulerOptions` are exported from `@restatedev/restate-sdk-gen`.

```ts
execute(ctx, build, { onMainExit: "join" });
```

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
- A spawned routine's lifetime is bounded by the main operation. Under
  the default `onMainExit: "abandon"`, the scheduler returns as soon as
  the main operation settles and abandons any routine (including race
  losers) still running — promptly, with no `catch`/`finally`. Pass
  `onMainExit: "join"` to keep driving until every spawned routine has
  finished.
