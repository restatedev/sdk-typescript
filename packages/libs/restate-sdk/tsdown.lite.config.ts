import { defineConfig } from "tsdown";
import path from "node:path";
import baseConfig from "./tsdown.config.js";

/**
 * Second build pass producing the `lite` entry points, which carry the pure
 * TypeScript shared core and none of the WASM payload.
 *
 * It compiles the same sources as the main build, with every internal import of
 * the shared-core selector redirected to the WASM-free seam. Because the two
 * passes emit into different directories, each entry family ends up with its
 * own module graph, and a bundler following `@restatedev/restate-sdk/lite`
 * never reaches the WASM build.
 *
 * Runs after the main build (see the package's `_build` script), so `clean` is
 * off here: cleaning would delete what the first pass just produced.
 */
const SELECTOR_SUFFIX = "vm/index.js";
const LITE_SEAM = path.resolve(
  import.meta.dirname,
  "src/endpoint/handlers/vm/lite.ts"
);

export default defineConfig({
  ...baseConfig,
  outDir: "dist/lite",
  clean: false,
  // package.json is owned by the main pass; see its customExports hook
  exports: false,
  plugins: [
    {
      name: "restate-lite-shared-core",
      resolveId(source: string, importer: string | undefined) {
        // `vm/index.js` is imported relatively, from more than one depth, so
        // match on the specifier's tail rather than on an exact path.
        if (importer !== undefined && source.endsWith(SELECTOR_SUFFIX)) {
          return LITE_SEAM;
        }
        return null;
      },
    },
  ],
});
