---
"@restatedev/restate-sdk-clients": patch
---

Retry the remaining safe ingress reads when `retry` is enabled

`result()` and `workflowOutput` were still one-shot GETs, so a request that raced
a draining ingress pod failed even though the durable invocation had completed
exactly once. They now use the same retry policy as `workflowAttach`, with no
idempotency-key gate: these reads only retrieve a result that already exists.

On a read, a caller-provided `signal` or `timeout` bounds the whole operation
including its retries. Handing each attempt a fresh timeout would silently
multiply the wait the caller asked for by `maxAttempts`, since the work being
waited on is already running elsewhere. Invocations keep their per-attempt
deadline, where each attempt does start the wait over.

`defaultShouldRetry` no longer retries a response that reports an invocation's
own outcome, identified by the `x-restate-id` header. A handler's `TerminalError`
surfaces with the failure's own status, which may be a `5xx`; retrying it only
delayed the same error.

`retry` policy overrides outside their documented domain — a non-integer or
unbounded `maxAttempts`, a negative or non-finite interval, an exponentiation
factor below 1 — now throw a `TypeError` instead of silently producing an
unbounded loop or a backoff that collapses to an immediate retry.
