import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/node.ts", "src/fetch.ts", "src/lambda.ts"],
  platform: "neutral",
  exports: {
    // tsdown derives `exports` from `entry`, but the `lite` entry points come
    // from the second build pass (tsdown.lite.config.ts), which must not touch
    // package.json — it would otherwise repoint the main entries at its own
    // output. Declare them here instead, so one pass owns the whole map.
    customExports(exports: Record<string, unknown>) {
      for (const [subpath, name] of [
        ["./lite", "index"],
        ["./lite/fetch", "fetch"],
        ["./lite/lambda", "lambda"],
        ["./lite/node", "node"],
      ]) {
        exports[subpath] = {
          import: `./dist/lite/${name}.js`,
          require: `./dist/lite/${name}.cjs`,
        };
      }
      return exports;
    },
  },
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
  ],
});
