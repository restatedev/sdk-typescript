---
"@restatedev/restate-sdk-gen": minor
---

Add `contextLocal<T>(default?)` — ambient, invocation-scoped key/value storage. A `contextLocal()` handle exposes `get()`/`set()` over a bag scoped to the current `execute()` call and shared by every fiber under it (the main routine, everything it `spawn`s, and combinator fallbacks). Use it to carry request-scoped context — a correlation id, a tenant, a logging prefix — through deeply nested helpers and spawned routines without threading a parameter. Define a slot once at module scope (minting touches no fiber); `get`/`set` it from inside the workflow body.

The storage is **global per invocation** (one shared bag, no per-fiber inheritance or isolation) and **in-memory only** — never journaled. It is deterministic across replay/suspension as long as values are set by deterministic workflow code (route raw I/O through `run` first, as with any local). It is not durable state: for values that must outlive the invocation, use `state()` / `sharedState()`. Exposes `contextLocal` and the `ContextLocal<T>` type.
