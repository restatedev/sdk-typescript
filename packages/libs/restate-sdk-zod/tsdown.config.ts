import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  platform: "neutral",
  exports: true,
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  unbundle: true,
  ignoreWatch: ["dist", ".turbo", "*.tsbuildinfo"],
});
