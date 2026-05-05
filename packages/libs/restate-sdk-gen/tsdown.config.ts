/*
 * Copyright (c) 2023-2026 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  platform: "neutral",
  exports: true,
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  ignoreWatch: ["dist", ".turbo", "*.tsbuildinfo"],
  external: ["@restatedev/restate-sdk"],
});
