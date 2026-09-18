# @restatedev/restate-sdk-tunnel-native

Serve a Restate SDK deployment as a **relay receiver** using the embedded
**native** engine (`restate-sdk-shared-core`, `tunnel` feature) via napi-rs —
the same Rust engine the Java SDK uses over FFM.

The engine dials the relay on its own tokio runtime and bridges each forwarded
request over a **loopback socket** into a local `node:http2` server, so SDK
request dispatch — and therefore **both the codegen SDK and the default promise
API** — is untouched. The napi boundary is control-plane only
(`start`/`status`/`stop`); no per-request data crosses it.

```ts
import { serveTunnel } from "@restatedev/restate-sdk-tunnel-native";
import * as restate from "@restatedev/restate-sdk";

const greeter = restate.service({
  name: "greeter",
  handlers: { greet: async () => "hi" },
});

const tunnel = await serveTunnel({
  services: [greeter],
  relay: {
    address: "relay.example:8080",
    env: "myenv",
    tunnel: "mytunnel",
    apiKey: process.env.RELAY_API_KEY!,
  },
});

// tunnel.status() -> { running, lastError }
// await tunnel.stop()  on shutdown
```

## Status — early / experimental

This is a fresh module (see `development/relay-receiver-napi-plan.md`). It is
**not** the pure-JS `@restatedev/restate-sdk-tunnel` package; the two are
complementary and will be reconciled later.

- **Node only**, and needs a native addon built for the host platform.
- v1 targets the relay's `/whoami` mode (the generic relay), matching the shared
  engine. Restate Cloud's `/_/start-tunnel` mode is not wired here yet.

## Building the native addon

The `.node` addon is **not** committed. Build it for the host platform with:

```sh
pnpm --filter @restatedev/restate-sdk-tunnel-native run build:native   # release
pnpm --filter @restatedev/restate-sdk-tunnel-native run _build         # tsc + tsdown wrapper
```

`build:native` runs `napi build` and pins the shared-core engine to its `relay`
branch (git dependency in `Cargo.toml`) with the `tunnel` feature.

## Deferred (packaging "later")

- The multi-platform prebuild matrix + `optionalDependencies` publishing + CI
  cross-compile (the standard napi-rs release flow).
- Swapping the shared-core git dependency for a crates.io release once the
  `tunnel` feature ships.
