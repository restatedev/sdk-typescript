---
"@restatedev/restate-sdk": minor
"@restatedev/restate-sdk-clients": minor
"@restatedev/restate-sdk-gen": minor
"@restatedev/restate-sdk-tunnel": minor
---

Align retry-policy terminology and expose scoped virtual-object clients.

- **restate-sdk-tunnel** (⚠️ breaking): the reconnect backoff options
  `reconnectInitialMs` / `reconnectMaxMs` / `reconnectFactor` are replaced by a
  nested `reconnectRetryPolicy: { initialInterval, maxInterval, exponentiationFactor }`,
  matching the field names used by the invocation and ingress retry policies. The
  `initialInterval` / `maxInterval` fields accept a `Duration` or a number of
  milliseconds.
- **restate-sdk-gen** (`run` retry): added `exponentiationFactor`; the previous
  `intervalFactor` is deprecated but still honored as a fallback.
- **restate-sdk** and **restate-sdk-clients**: scoped requests now expose
  `objectClient` / `objectSendClient` for virtual objects, so
  `ctx.scope(...)` / `ingress.scope(...)` can route calls and sends to a virtual
  object (the object key is part of the scoped identity).
