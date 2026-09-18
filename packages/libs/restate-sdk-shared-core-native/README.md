# @restatedev/restate-sdk-shared-core-native

Native ([napi-rs](https://napi.rs)) build of the Restate shared-core state
machine. It is loaded automatically by
[`@restatedev/restate-sdk`](https://www.npmjs.com/package/@restatedev/restate-sdk)
on Node.js to avoid the WASM 4&nbsp;GB memory ceiling and reduce buffer copies.

You should not depend on this package directly — install `@restatedev/restate-sdk`,
which lists it as an optional dependency and falls back to its bundled WASM build
on runtimes where a prebuilt binary is not available (Bun, Deno, Cloudflare
Workers, edge, browser, or unsupported CPU architectures).

Prebuilt binaries are published as per-platform packages
(`@restatedev/restate-sdk-shared-core-native-<platform>`) and selected at runtime
by `index.js`. Supported targets: Linux x64/arm64 (glibc and musl) and macOS
arm64.

This package exposes the same JS surface as the WASM binding shipped in
`@restatedev/restate-sdk`, and is kept in lockstep with
`sdk-shared-core-wasm-bindings` to preserve functional parity.
