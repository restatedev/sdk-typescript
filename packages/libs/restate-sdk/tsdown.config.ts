import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/node.ts", "src/fetch.ts", "src/lambda.ts"],
  platform: "neutral",
  exports: true,
  format: ["esm", "cjs"],
  dts: true,
  ignoreWatch: ["dist", ".turbo", "*.tsbuildinfo"],
  unbundle: true,
  clean: true,
  external: [
    "@restatedev/restate-sdk-core",
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
