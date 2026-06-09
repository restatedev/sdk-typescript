---
"@restatedev/restate-sdk-gen": minor
---

Add `task.interrupt(err?)` — a per-task interrupt primitive. `spawn(op)` now returns a `Task<T>` (a `Future<T>` plus `interrupt`); calling `task.interrupt(err)` throws `err` into the spawned routine at its next yield point (verbatim, or a default `InterruptedError` if omitted) and aborts that routine's in-flight `run` I/O. Interrupt is swallowable — the routine's own try/catch may catch and recover — and is the per-routine counterpart to invocation cancellation, filling the gap previously left to cooperative stop-channels. Interrupt **cascades down the spawn subtree**: every routine the task spawned (transitively) is interrupted too, with the same error, so interrupting a parent winds down the whole tree it rooted (nursery semantics); routines spawned elsewhere are untouched.

Each fiber now lazily owns its own `AbortSignal` (a child of the scheduler signal), so `run` closures inside an interrupted routine cancel promptly while siblings' in-flight I/O is untouched; invocation cancellation / attempt-end still cascade in. Under the default `onMainExit: "abandon"`, interrupt-then-return abandons the routine before its cleanup runs — interrupt then `yield*` the task ("interrupt-then-join") to drive its `catch`/`finally`. Exposes `Task` and `InterruptedError`.
