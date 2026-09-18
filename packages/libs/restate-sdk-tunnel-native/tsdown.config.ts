import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  platform: "node",
  exports: true,
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  ignoreWatch: ["dist", ".turbo", "*.tsbuildinfo"],
  // Keep the SDK peer + the napi binding out of the bundle. The generated
  // `../index.cjs` (napi loader) + its `.node` are shipped alongside `dist/`
  // and required at runtime; bundling them would break the native load.
  external: ["@restatedev/restate-sdk", "../index.cjs"],
});
