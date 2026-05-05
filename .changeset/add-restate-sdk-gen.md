---
"@restatedev/restate-sdk-gen": minor
---

Initial release of `@restatedev/restate-sdk-gen` — a generator-based DSL for composing Restate workflows. Built around `Operation<T>` (lazy, one-shot) and `Future<T>` (eager, memoized); user code writes `gen(function*() { ... })` bodies and yields primitives (`run`, `sleep`, `awakeable`, `channel`, `select`, `race`, `all`, `spawn`, …) that the scheduler dispatches against the Restate runtime. `@restatedev/restate-sdk` is a peer dependency.
