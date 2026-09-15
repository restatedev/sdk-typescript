# @restatedev/tanstack-workflow

Run [`@tanstack/workflow-core`](https://www.npmjs.com/package/@tanstack/workflow-core)
workflow definitions on [Restate](https://restate.dev). Same authoring API,
different runtime.

```bash
npm install @restatedev/tanstack-workflow @tanstack/workflow-core
```

## What it does

This is a **runtime** adapter, not a host adapter. It does not use TanStack's
`runWorkflow` / `RunStore`, which would keep the TanStack replay engine as the
executor and reduce Restate to a key-value store. Instead each workflow becomes a
Restate Virtual Object keyed by `runId`, and the TanStack `ctx` is built directly
on a Restate `ObjectContext`. Steps become real journal entries.

| TanStack `ctx` | Restate |
|---|---|
| `runId` | the Virtual Object key |
| `step(id, fn, { retry })` | `ctx.run(id, fn, opts)`, journaled, retried, skipped on replay |
| `sleep` / `sleepUntil` | Restate timers |
| `waitForEvent(name)` | an awakeable, resolved by the shared `signal` handler |
| `approve()` | an awakeable, resolved by the shared `approve` handler |
| `now()` / `uuid()` | `ctx.date.now()` / `ctx.rand.uuidv4()` |

Each workflow is exposed as an object with three handlers: `run` (exclusive),
`signal` (shared) and `approve` (shared). Run-once semantics come from passing the
`runId` as the caller's idempotency key.

## Usage

```ts
import { createWorkflow } from "@tanstack/workflow-core";
import { createWorkflowEndpoint } from "@restatedev/tanstack-workflow";

const checkout = createWorkflow({ id: "checkout", /* ... */ }).handler(
  async (ctx) => {
    const charge = await ctx.step("charge-card", (step) =>
      stripe.charges.create(args, { idempotencyKey: step.id })
    );
    return { status: "approved" as const };
  }
);

export default {
  fetch: createWorkflowEndpoint({ workflows: [checkout] }),
};
```

`createWorkflowEndpoint` returns a standard `fetch` handler, so it runs on
Cloudflare Workers, Deno, Bun, Vercel and anything else with the Fetch API. Use
`restateWorkflow(def)` directly if you want the Virtual Object without an
endpoint.

### Cloudflare Workers

Two `wrangler.toml` settings are required:

```toml
compatibility_flags = ["nodejs_compat"]  # the UUID helper imports node:buffer
minify = false                           # the CF minifier breaks the Restate SDK
```

## The Restate SDK is bundled, on purpose

This package does **not** depend on `@restatedev/restate-sdk`. The SDK is bundled
in at build time from its WebAssembly-free entry point, so that:

- the published package runs on hosts that do not support WebAssembly,
- consumers never install the SDK or see its `lite` subpath,
- nothing ships the SDK's 2.2 MB inlined WebAssembly payload.

This is the opposite of every other Restate integration package, which peer-depend
on the SDK. **Do not "fix" `@restatedev/restate-sdk` into `dependencies` or
`peerDependencies`.** Doing so silently reintroduces WebAssembly and breaks the
hosts this package exists to support. `scripts/assert-no-wasm.mjs` guards the
build output, but it cannot guard a `package.json` edit.

Because the SDK is hidden, this package re-exports the Restate types its own API
exposes (`ObjectContext`, `TerminalError` and friends) so you can name them
without installing the SDK.

If you also install `@restatedev/restate-sdk` directly, for other services, you
will have two copies of the SDK in your dependency tree. That works: handlers are
branded with a global symbol, so they are recognised across copies.

`@tanstack/workflow-core` is a peer dependency, not bundled. You author workflows
against your own copy, and its types stay yours.

## Error semantics

Restate retries a handler that throws a plain `Error`, and stops when it throws a
`TerminalError`. Schema validation is deterministic, so every validation failure
is terminal: bad input, a bad `waitForEvent` payload, an output or initial state
the schema rejects, and the two middleware contract violations. Input and signal
payload failures carry HTTP 400, which propagates to the ingress caller.

Your own code inside `ctx.step` keeps the normal Restate default: it is retried
unless you throw a `TerminalError`, or set `retry.shouldRetry` to return false,
which the adapter converts into one for you.

## Known gaps

- Step retry maps `maxAttempts` / `baseMs` / `backoff` onto `ctx.run` options.
  `shouldRetry: false` becomes a `TerminalError`. Custom function backoff,
  per-attempt `timeout` and `StepContext.attempt` are approximated.
- A signal that arrives before its wait is registered has nothing to resolve.
  Buffering is a follow-up.
- No `runWorkflow` event stream or TanStack devtools log. Observability is
  Restate's: the UI, `sys_journal` and `sys_invocation_status`.
- Schedules (`defineScheduledWorkflow`, cron) and version routing are out of
  scope; they overlap Restate's own deployment versioning.
