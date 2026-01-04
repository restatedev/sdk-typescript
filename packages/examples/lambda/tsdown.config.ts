import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  platform: "node",
  target: "es2020",
  outDir: "dist",
  format: ["esm"],
  minify: true,
  dts: false,
  unbundle: false,
  ignoreWatch: ["dist", ".turbo", "*.tsbuildinfo"],
  external: [],
  exports: false,
  fixedExtension: true,
  noExternal: () => true,
});
