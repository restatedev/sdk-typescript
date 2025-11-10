import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  platform: "neutral",
  format: ["esm"],
  dts: false,
  bundle: true,
  ignoreWatch: ["dist", ".turbo", "*.tsbuildinfo"],
  external: [],
  exports: false,
  noExternal: () => true,
});
