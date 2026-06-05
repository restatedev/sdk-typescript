---
"@restatedev/restate-sdk-gen": minor
---

BREAKING (behavior): `execute`/`Scheduler.run` no longer waits for every spawned routine to finish. By default (`onMainExit: "abandon"`) the handler returns as soon as the main operation settles; spawned routines and race losers still running at that point are abandoned at their current suspension point (never resumed, no `catch`/`finally`). This removes the race-loser/fire-and-forget hang where a routine parked on a never-settling source kept the handler alive forever. To restore the old wait-for-all behavior, pass `{ onMainExit: "join" }` as the new third argument of `execute` (now exported from the package, together with the `ExecuteOptions`, `SchedulerOptions`, and `OnMainExit` types). If you rely on a fire-and-forget spawn completing, `yield*` its future before returning or use `"join"`.
