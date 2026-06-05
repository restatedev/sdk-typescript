# @restatedev/restate-sdk-gen

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
