import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  platform: "neutral",
  exports: true,
  format: ["esm", "cjs"],
  dts: true,
  unbundle: true,
  clean: true,
  ignoreWatch: ["dist", ".turbo", "*.tsbuildinfo"],
  external: ["http2"],
});
