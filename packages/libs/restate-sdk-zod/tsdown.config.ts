import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  platform: "neutral",
  exports: true,
  format: ["esm", "cjs"],
  dts: true,
  ignoreWatch: ["dist", ".turbo", "*.tsbuildinfo"],
});
