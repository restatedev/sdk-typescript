import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  // Build against tsconfig.tsdown.json, which overrides the repo-wide NodeNext
  // module resolution with "Bundler". This is load-bearing. Under NodeNext the
  // declaration bundler walks the SDK's package.json `exports` map, which has no
  // `types` condition, lands on the runtime `dist/lite/fetch.js`, and then fails
  // with "`internal_exports` is not declared in this file". Bundler resolution
  // finds `dist/lite/fetch.d.ts` directly and rolls the declarations up cleanly.
  tsconfig: "tsconfig.tsdown.json",
  platform: "neutral",
  exports: true,
  format: ["esm", "cjs"],
  clean: true,

  // The Restate SDK is deliberately NOT listed as external, which inverts the
  // monorepo convention documented in CLAUDE.md. It is bundled in from the
  // WebAssembly-free `@restatedev/restate-sdk/lite/fetch` entry so that
  // consumers never install it, never see the `lite` subpath, and never ship
  // the 2.2 MB inlined wasm payload. Moving `@restatedev/restate-sdk` out of
  // devDependencies into dependencies or peerDependencies would undo all of
  // that. `scripts/assert-no-wasm.mjs` guards the build output.
  //
  // `@tanstack/workflow-core` is the opposite case: it is a peer dependency the
  // consumer already has, so it stays external and is never bundled.
  external: [/^node:/, "@tanstack/workflow-core"],

  // Bundling the JavaScript is not enough on its own. By default the emitted
  // .d.ts still contains `import { ObjectContext } from
  // "@restatedev/restate-sdk/lite/fetch"`, which does not resolve for anyone
  // who has not installed the SDK. `resolve` inlines those declarations so the
  // published types are self-contained.
  //
  // `@tanstack/workflow-core` is intentionally absent from this list: its types
  // must stay a reference to the consumer's own copy, not a structural clone.
  dts: { resolve: ["@restatedev/restate-sdk", "@restatedev/restate-sdk-core"] },

  ignoreWatch: ["dist", ".turbo", "*.tsbuildinfo"],
});
