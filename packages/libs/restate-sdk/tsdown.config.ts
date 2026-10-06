import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/node.ts",
    "src/fetch.ts",
    "src/lambda.ts",
    // Built as its own entry (not reachable through the graph, since `#vm` is external) so the
    // native selector lands at dist/endpoint/handlers/vm/index.js — the `#vm` default target.
    "src/endpoint/handlers/vm/index.ts",
  ],
  platform: "neutral",
  // Exports are hand-managed in package.json: the vm selector is built as an entry (so it lands in
  // dist for the `#vm` conditional) but must NOT become a public `./endpoint/handlers/vm` export.
  exports: false,
  format: ["esm", "cjs"],
  dts: true,
  ignoreWatch: ["dist", ".turbo", "*.tsbuildinfo"],
  unbundle: true,
  clean: true,
  external: [
    "@restatedev/restate-sdk-core",
    // Shared-core selector: resolved at runtime via the `#vm` conditional subpath import
    // (native on Node/Deno/Bun, wasm on workerd/edge). Never bundled.
    "#vm",
    // Native shared-core addon: loaded at runtime via createRequire, never bundled.
    "@restatedev/restate-sdk-shared-core-native",
    // Node.js built-in modules
    "http2",
    "node:module",
    "node:stream",
    "node:stream/web",
    "node:buffer",
    "node:timers/promises",
    "node:zlib",
  ],
});
