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
    // Node.js built-in modules
    "http2",
    "node:stream",
    "node:stream/web",
    "node:buffer",
    "node:timers/promises",
    "node:zlib",
    // used by the tunnel engine (connect mode of serve())
    "node:http",
    "node:http2",
    "node:net",
    "node:tls",
    "node:dns",
    "node:os",
    "node:fs",
    "node:crypto",
  ],
});
