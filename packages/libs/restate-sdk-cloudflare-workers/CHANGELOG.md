# @restatedev/restate-sdk-cloudflare-workers

## 1.14.2

### Bug fixes

- eb0afbf: Fixed a memory leak in the fetch-based endpoint handler after completed invocations.
- Updated dependencies [eb0afbf]
  - @restatedev/restate-sdk-core@1.14.2

## 1.14.1

### Improvements and bug fixes

- Added a connection-level default `serde` option to the ingress client. It is used for calls, workflow attach/output, awakeable resolution, and attached invocation results when no operation-specific serde is provided.
- Operation-level `input`/`output` serdes still take precedence over the connection default.

### Patch Changes

- Updated dependencies
  - @restatedev/restate-sdk-core@1.14.1

## 1.14.0

### New Features

#### Serde Preview

Serde definitions can now expose preview conversions between their wire format and editable JSON through `Serde.preview`. SDK endpoints advertise previewable handler inputs and outputs in discovery and serve signed `/serdes/.../encode|decode/...` preview routes for Restate tooling.

Serde Preview requires Restate Server 1.7 or newer.

### Improvements and bug fixes

- `RestateTestEnvironment` now defaults to `serviceEndpointAccess: "docker-host"` and `storage: "memory"` for faster disposable tests. Set `serviceEndpointAccess: "testcontainers"` or `storage: "disk"` to opt back into the previous behavior.
- Removed the deprecated `RestateTestEnvironment.start(server => ...)` API; pass `TestEnvironmentOptions` instead.
- Fixed workflow submission options handling and await-loop progress while input may still advance execution.
- Fixed response-head handling across endpoint adapters.

### Patch Changes

- Updated dependencies
  - @restatedev/restate-sdk-core@1.14.0

## 1.13.0

### Minor Changes

- a296aa5: Fixes to `RestatePromise.map`:
  - **Bug fix:** for promises created via `RestatePromise.resolve()` / `RestatePromise.reject()`, `.map()` is now correctly executed.
  - **Bug fix/Behavioral breaking change:** for all other promises, the mapper closure now runs **exactly once**, regardless of how many times the resulting promise is awaited. Previously it ran on every await.

- a296aa5: Add `setOutputContentTypeIfEmpty` handler option, allowing handlers to configure the response `content-type` header when the output body is empty.
  This is needed when using Protobuf, where an empty body is still a valid message and the `content-type` must be set accordingly.

### Patch Changes

- Updated dependencies [a296aa5]
- Updated dependencies [a296aa5]
  - @restatedev/restate-sdk-core@1.13.0

## 1.12.0

### New Features

#### Hooks and OpenTelemetry

A new hooks system lets you intercept handler execution and `ctx.run()` closures at the endpoint, service, or handler level.

Use it to integrate with your favourite observability libraries:

```typescript
const myHookProvider: HooksProvider = (ctx) => ({
  interceptor: {
    handler: async (next) => {
      console.log(`before ${ctx.request.target}`);
      try {
        await next();
      } finally {
        console.log(`after ${ctx.request.target}`);
      }
    },
    run: async (name, next) => {
      console.log(`  run "${name}" executing`);
      await next();
    },
  },
});

// Then in the service configuration:

const myService = restate.service({
    name: "MyService",
    handlers: { ... },
    options: {
        hooks: [myHookProvider],
    },
});
```

Together with the hooks interface, the new `@restatedev/restate-sdk-opentelemetry` package provides a ready-made OpenTelemetry integration.

It automatically propagates trace context from Restate and creates spans with standard Restate attributes (`restate.invocation.id`, `restate.invocation.target`):

```typescript
import { openTelemetryHook } from "@restatedev/restate-sdk-opentelemetry";
import { trace } from "@opentelemetry/api";

const greeter = restate.service({
  name: "Greeter",
  options: {
    // Set up the openTelemetryHook
    hooks: [openTelemetryHook({ tracer: trace.getTracer("greeter-service") })],
  },
  handlers: {
    greet: async (ctx: Context, name: string) => {
      // Add an event using trace.getActiveSpan().addEvent()
      trace.getActiveSpan()?.addEvent("my.event", { name });

      // ctx.runs get automatically their span, child of the handler attempt span.
      const greeting = await ctx.run("compute-greet", async () => {
        // You can get the ctx.run span here for downstream propagation
        const span = trace.getActiveSpan();
        return `Hello ${name}!`;
      });

      return greeting;
    },
  },
});
```

For more complete examples, check out:

- OpenTelemetry integration example: https://github.com/restatedev/examples/tree/main/typescript/integrations/opentelemetry

#### HTTP/1.1 Handler for Node.js

`restate.createEndpointHandler()` now returns a handler that works with both HTTP/2 and HTTP/1.1. It auto-detects the HTTP version per request:

```typescript
import * as http from "node:http";

const restateSDKHandler = restate.createEndpointHandler({
  services: [myService],
});
const server = http.createServer(restateSDKHandler);
server.listen(9080);
```

#### `RestatePromise` improvements

New factory methods to create already-completed Restate promises, mirroring `Promise.resolve`/`Promise.reject`:

```typescript
RestatePromise.resolve(myValue);
RestatePromise.reject(new restate.TerminalError("Access denied"));
```

We also expose `isRestatePromise` to reliably detect whether a promise is a `RestatePromise`.

#### Testcontainer options

`alwaysReplay` and `disableRetries` options added to the Restate testcontainer, to simplify testing edge cases in your code.

Check [`RestateContainer`](https://restatedev.github.io/sdk-typescript/classes/_restatedev_restate-sdk-testcontainers.RestateContainer.html) documentation for more details.

#### Experimental APIs

We're releasing two new experimental APIs:

- Explicit cancellation, to manually handle Restate's cancellation, instead of relying on `RestatePromise` failing with `CancelledError` when cancellation is received.
- Signals, a way for invocations to communicate between each other.

For more info on these features, refer to the [`ContextInternal`](https://restatedev.github.io/sdk-typescript/interfaces/_restatedev_restate-sdk.internal.ContextInternal.html) documentation.
The API of these features is experimental and might change in future releases.

### Improvements and bug fixes

- `Awakeable.reject()` now accepts a `TerminalError`, propagating error message, code, and metadata.
- Added `asTerminalError` and default `serde` handler option. These take precedence over the already existing service/endpoint level configuration.
- `RestatePromise` combinators now correctly handle empty input arrays (#611).
- `Request.id` is now an `InvocationId`.
- Added `Request.target` to get the full invocation target.
- Removed deprecated `SendOpts` (use `SendOptions`).
- Removed deprecated `*millis` fields in retry policy.

### Patch Changes

- Updated dependencies [4b88bc1]
  - @restatedev/restate-sdk-core@1.12.0

## 1.11.1

### Patch Changes

- Updated testcontainers version
- Updated dependencies
  - @restatedev/restate-sdk-core@1.11.1

## 1.11.0

### Minor Changes

- Re-design the internal endpoint abstration, to better handle incorrect h2 stream closure and similar issues
- Added TerminalError.metadata field, to add structured data to error values

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @restatedev/restate-sdk-core@1.11.0

## 1.10.4

### Patch Changes

- 4e46eef: Add ContextInternal interface
- 4e46eef: Fix issue with CloudRun and big non-completable journal entries
- Updated dependencies [4e46eef]
- Updated dependencies [4e46eef]
  - @restatedev/restate-sdk-core@1.10.4

## 1.10.3

### Patch Changes

- 4b477f6: Add rpc.opts({name})/rpc.sendOpts({name}) to propagate entry name for call. This allows tagging from caller perspective a request.
- ef1cc48: Added new journal incompatibility assertion to shared-core, to detect if an await was added mutating code in-place.
- 4b477f6: Update the shared core to 0.8.0
- Updated dependencies [4b477f6]
- Updated dependencies [ef1cc48]
- Updated dependencies [4b477f6]
  - @restatedev/restate-sdk-core@1.10.3

## 1.10.2

### Patch Changes

- Fix error stacktrace propagation on ctx.run failures
- Fix restate.serde.schema config propagation
- Updated dependencies
- Updated dependencies
  - @restatedev/restate-sdk-core@1.10.2

## 1.10.1

### Patch Changes

- 7b49297: Fix standard schema import
- Updated dependencies [7b49297]
  - @restatedev/restate-sdk-core@1.10.1

## 1.10.0

### Minor Changes

- df0ffc3: Introduce `restate.serde.schema` to create a serde using the Standard Schema spec

### Patch Changes

- Updated dependencies [df0ffc3]
  - @restatedev/restate-sdk-core@1.10.0
