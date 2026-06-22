# @restatedev/restate-sdk-gen

## 1.15.0

### Minor Changes

- ffadd88: Bump to 1.15.0 rc.6
- f05a8ef: BREAKING (behavior): `execute`/`Scheduler.run` no longer waits for every spawned routine to finish. By default (`onMainExit: "abandon"`) the handler returns as soon as the main operation settles; spawned routines and race losers still running at that point are abandoned at their current suspension point (never resumed, no `catch`/`finally`). This removes the race-loser/fire-and-forget hang where a routine parked on a never-settling source kept the handler alive forever. To restore the old wait-for-all behavior, pass `{ onMainExit: "join" }` as the new third argument of `execute` (now exported from the package, together with the `ExecuteOptions`, `SchedulerOptions`, and `OnMainExit` types). If you rely on a fire-and-forget spawn completing, `yield*` its future before returning or use `"join"`.
- dcd51ba: Added RunRetryPolicy.onMaxAttempts = pause and PauseError
- Bump to 1.15.0
- 65aeaf1: Add `contextLocal<T>(default?)` — ambient, invocation-scoped key/value storage. A `contextLocal()` handle exposes `get()`/`set()` over a bag scoped to the current `execute()` call and shared by every fiber under it (the main routine, everything it `spawn`s, and combinator fallbacks). Use it to carry request-scoped context — a correlation id, a tenant, a logging prefix — through deeply nested helpers and spawned routines without threading a parameter. Define a slot once at module scope (minting touches no fiber); `get`/`set` it from inside the workflow body.

  The storage is **global per invocation** (one shared bag, no per-fiber inheritance or isolation) and **in-memory only** — never journaled. It is deterministic across replay/suspension as long as values are set by deterministic workflow code (route raw I/O through `run` first, as with any local). It is not durable state: for values that must outlive the invocation, use `state()` / `sharedState()`. Exposes `contextLocal` and the `ContextLocal<T>` type.

- 1034766: Add `task.interrupt(err?)` — a per-task interrupt primitive. `spawn(op)` now returns a `Task<T>` (a `Future<T>` plus `interrupt`); calling `task.interrupt(err)` throws `err` into the spawned routine at its next yield point (verbatim, or a default `InterruptedError` if omitted) and aborts that routine's in-flight `run` I/O. Interrupt is swallowable — the routine's own try/catch may catch and recover — and is the per-routine counterpart to invocation cancellation, filling the gap previously left to cooperative stop-channels. Interrupt **cascades down the spawn subtree**: every routine the task spawned (transitively) is interrupted too, with the same error, so interrupting a parent winds down the whole tree it rooted (nursery semantics); routines spawned elsewhere are untouched.

  Each fiber now lazily owns its own `AbortSignal` (a child of the scheduler signal), so `run` closures inside an interrupted routine cancel promptly while siblings' in-flight I/O is untouched; invocation cancellation / attempt-end still cascade in. Under the default `onMainExit: "abandon"`, interrupt-then-return abandons the routine before its cleanup runs — interrupt then `yield*` the task ("interrupt-then-join") to drive its `catch`/`finally`. Exposes `Task` and `InterruptedError`.

- 59868ef: Bump to 1.15.0-rc.5

### Patch Changes

- 24b5263: 1.15.0-rc.7
- 1f850e1:
- Updated dependencies [ffadd88]
- Updated dependencies [dcd51ba]
- Updated dependencies
- Updated dependencies [24b5263]
- Updated dependencies [1f850e1]
- Updated dependencies [59868ef]
  - @restatedev/restate-sdk-clients@1.15.0
  - @restatedev/restate-sdk-core@1.15.0

## 1.15.0-rc.7

### Patch Changes

- 1.15.0-rc.7
- Updated dependencies
  - @restatedev/restate-sdk-clients@1.15.0-rc.7
  - @restatedev/restate-sdk-core@1.15.0-rc.7

## 1.15.0-rc.6

### Minor Changes

- Bump to 1.15.0 rc.6

### Patch Changes

- Updated dependencies
  - @restatedev/restate-sdk-clients@1.15.0-rc.6
  - @restatedev/restate-sdk-core@1.15.0-rc.6

## 1.15.0-rc.5

### Minor Changes

- Bump to 1.15.0-rc.5

### Patch Changes

- Updated dependencies
  - @restatedev/restate-sdk-clients@1.15.0-rc.5
  - @restatedev/restate-sdk-core@1.15.0-rc.5

## 1.15.0-rc.4

### Patch Changes

-
- Updated dependencies
  - @restatedev/restate-sdk-clients@1.15.0-rc.4
  - @restatedev/restate-sdk-core@1.15.0-rc.4

## 1.15.0-rc.3

### Minor Changes

- f05a8ef: BREAKING (behavior): `execute`/`Scheduler.run` no longer waits for every spawned routine to finish. By default (`onMainExit: "abandon"`) the handler returns as soon as the main operation settles; spawned routines and race losers still running at that point are abandoned at their current suspension point (never resumed, no `catch`/`finally`). This removes the race-loser/fire-and-forget hang where a routine parked on a never-settling source kept the handler alive forever. To restore the old wait-for-all behavior, pass `{ onMainExit: "join" }` as the new third argument of `execute` (now exported from the package, together with the `ExecuteOptions`, `SchedulerOptions`, and `OnMainExit` types). If you rely on a fire-and-forget spawn completing, `yield*` its future before returning or use `"join"`.
- dcd51ba: Added RunRetryPolicy.onMaxAttempts = pause and PauseError
- 65aeaf1: Add `contextLocal<T>(default?)` — ambient, invocation-scoped key/value storage. A `contextLocal()` handle exposes `get()`/`set()` over a bag scoped to the current `execute()` call and shared by every fiber under it (the main routine, everything it `spawn`s, and combinator fallbacks). Use it to carry request-scoped context — a correlation id, a tenant, a logging prefix — through deeply nested helpers and spawned routines without threading a parameter. Define a slot once at module scope (minting touches no fiber); `get`/`set` it from inside the workflow body.

  The storage is **global per invocation** (one shared bag, no per-fiber inheritance or isolation) and **in-memory only** — never journaled. It is deterministic across replay/suspension as long as values are set by deterministic workflow code (route raw I/O through `run` first, as with any local). It is not durable state: for values that must outlive the invocation, use `state()` / `sharedState()`. Exposes `contextLocal` and the `ContextLocal<T>` type.

- 1034766: Add `task.interrupt(err?)` — a per-task interrupt primitive. `spawn(op)` now returns a `Task<T>` (a `Future<T>` plus `interrupt`); calling `task.interrupt(err)` throws `err` into the spawned routine at its next yield point (verbatim, or a default `InterruptedError` if omitted) and aborts that routine's in-flight `run` I/O. Interrupt is swallowable — the routine's own try/catch may catch and recover — and is the per-routine counterpart to invocation cancellation, filling the gap previously left to cooperative stop-channels. Interrupt **cascades down the spawn subtree**: every routine the task spawned (transitively) is interrupted too, with the same error, so interrupting a parent winds down the whole tree it rooted (nursery semantics); routines spawned elsewhere are untouched.

  Each fiber now lazily owns its own `AbortSignal` (a child of the scheduler signal), so `run` closures inside an interrupted routine cancel promptly while siblings' in-flight I/O is untouched; invocation cancellation / attempt-end still cascade in. Under the default `onMainExit: "abandon"`, interrupt-then-return abandons the routine before its cleanup runs — interrupt then `yield*` the task ("interrupt-then-join") to drive its `catch`/`finally`. Exposes `Task` and `InterruptedError`.

### Patch Changes

- Updated dependencies [dcd51ba]
  - @restatedev/restate-sdk-clients@1.15.0-rc.3
  - @restatedev/restate-sdk-core@1.15.0-rc.3

## 1.15.0-rc.2

### Minor Changes

- Added RunRetryPolicy.onMaxAttempts = pause and PauseError
- 65aeaf1: Add `contextLocal<T>(default?)` — ambient, invocation-scoped key/value storage. A `contextLocal()` handle exposes `get()`/`set()` over a bag scoped to the current `execute()` call and shared by every fiber under it (the main routine, everything it `spawn`s, and combinator fallbacks). Use it to carry request-scoped context — a correlation id, a tenant, a logging prefix — through deeply nested helpers and spawned routines without threading a parameter. Define a slot once at module scope (minting touches no fiber); `get`/`set` it from inside the workflow body.

  The storage is **global per invocation** (one shared bag, no per-fiber inheritance or isolation) and **in-memory only** — never journaled. It is deterministic across replay/suspension as long as values are set by deterministic workflow code (route raw I/O through `run` first, as with any local). It is not durable state: for values that must outlive the invocation, use `state()` / `sharedState()`. Exposes `contextLocal` and the `ContextLocal<T>` type.

- 1034766: Add `task.interrupt(err?)` — a per-task interrupt primitive. `spawn(op)` now returns a `Task<T>` (a `Future<T>` plus `interrupt`); calling `task.interrupt(err)` throws `err` into the spawned routine at its next yield point (verbatim, or a default `InterruptedError` if omitted) and aborts that routine's in-flight `run` I/O. Interrupt is swallowable — the routine's own try/catch may catch and recover — and is the per-routine counterpart to invocation cancellation, filling the gap previously left to cooperative stop-channels. Interrupt **cascades down the spawn subtree**: every routine the task spawned (transitively) is interrupted too, with the same error, so interrupting a parent winds down the whole tree it rooted (nursery semantics); routines spawned elsewhere are untouched.

  Each fiber now lazily owns its own `AbortSignal` (a child of the scheduler signal), so `run` closures inside an interrupted routine cancel promptly while siblings' in-flight I/O is untouched; invocation cancellation / attempt-end still cascade in. Under the default `onMainExit: "abandon"`, interrupt-then-return abandons the routine before its cleanup runs — interrupt then `yield*` the task ("interrupt-then-join") to drive its `catch`/`finally`. Exposes `Task` and `InterruptedError`.

### Patch Changes

- Updated dependencies
  - @restatedev/restate-sdk@1.15.0-rc.2
  - @restatedev/restate-sdk-clients@1.15.0-rc.2
  - @restatedev/restate-sdk-core@1.15.0-rc.2

## 1.15.0-rc.1

### Minor Changes

- f05a8ef: BREAKING (behavior): `execute`/`Scheduler.run` no longer waits for every spawned routine to finish. By default (`onMainExit: "abandon"`) the handler returns as soon as the main operation settles; spawned routines and race losers still running at that point are abandoned at their current suspension point (never resumed, no `catch`/`finally`). This removes the race-loser/fire-and-forget hang where a routine parked on a never-settling source kept the handler alive forever. To restore the old wait-for-all behavior, pass `{ onMainExit: "join" }` as the new third argument of `execute` (now exported from the package, together with the `ExecuteOptions`, `SchedulerOptions`, and `OnMainExit` types). If you rely on a fire-and-forget spawn completing, `yield*` its future before returning or use `"join"`.
- Changes for Restate SDK 1.15.0-rc.1

### Patch Changes

- Updated dependencies
  - @restatedev/restate-sdk@1.15.0-rc.1
  - @restatedev/restate-sdk-clients@1.15.0-rc.1
  - @restatedev/restate-sdk-core@1.15.0-rc.1

## 1.15.0-rc.0

### Minor Changes

- RC1 pre-release

### Patch Changes

- Updated dependencies
  - @restatedev/restate-sdk@1.15.0-rc.0
  - @restatedev/restate-sdk-clients@1.15.0-rc.0
  - @restatedev/restate-sdk-core@1.15.0-rc.0

## 1.14.3

### Patch Changes

- Added Ingress.call/send to do generic calls/sends using the Ingress client
- Updated dependencies
  - @restatedev/restate-sdk@1.14.3
  - @restatedev/restate-sdk-clients@1.14.3
  - @restatedev/restate-sdk-core@1.14.3

## 1.14.2

### Bug fixes

- eb0afbf: Fixed a memory leak in the fetch-based endpoint handler after completed invocations.
- Updated dependencies [eb0afbf]
  - @restatedev/restate-sdk@1.14.2
