/*
 * Copyright (c) 2023-2025 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

// The `lite` entry points exist so that a bundle following them contains no
// WebAssembly. That property comes from one redirect in tsdown.lite.config.ts,
// which is easy to break without noticing, so assert it rather than trust it.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const LITE_DIR = "dist/lite";
const NEEDLES = ["WebAssembly", "__wasm_base64__", "wbindgen"];

function* codeFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* codeFiles(full);
    } else if (full.endsWith(".js") || full.endsWith(".cjs")) {
      yield full;
    }
  }
}

const offenders = [];
for (const file of codeFiles(LITE_DIR)) {
  const src = readFileSync(file, "utf8");
  const hit = NEEDLES.find((n) => src.includes(n));
  if (hit !== undefined) {
    offenders.push(`${file} (contains ${hit})`);
  }
}

if (offenders.length > 0) {
  console.error(
    `The lite build must not reference WebAssembly, but ${offenders.length} file(s) do:\n  ` +
      offenders.join("\n  ") +
      "\n\nCheck that tsdown.lite.config.ts still redirects the shared-core seam."
  );
  process.exit(1);
}

console.log(
  `lite build is WebAssembly-free (${[...codeFiles(LITE_DIR)].length} files checked)`
);
