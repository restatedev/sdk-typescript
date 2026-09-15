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

// Fails the build if any WebAssembly ever reaches this package's output.
//
// This package bundles the Restate SDK from its `/lite/fetch` entry precisely
// so that the published artifact runs on hosts without WebAssembly. A single
// import rewritten to `@restatedev/restate-sdk/fetch` would silently pull the
// 2.2 MB inlined wasm blob back in and nothing else would notice.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");

const FORBIDDEN = ["WebAssembly", "__wasm_base64__", "wbindgen"];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

let scanned = 0;
const offenders = [];

for (const file of walk(dist)) {
  if (!/\.(js|cjs|mjs|ts|cts|mts)$/.test(file)) continue;
  scanned += 1;
  const text = readFileSync(file, "utf8");
  const hits = FORBIDDEN.filter((needle) => text.includes(needle));
  if (hits.length > 0) {
    offenders.push(`${relative(root, file)}: ${hits.join(", ")}`);
  }
}

if (offenders.length > 0) {
  console.error(
    `assert-no-wasm: WebAssembly leaked into the bundle (${offenders.length} file(s)):`
  );
  for (const o of offenders) console.error(`  ${o}`);
  console.error(
    "\nThis package must bundle @restatedev/restate-sdk/lite/fetch, not /fetch."
  );
  process.exit(1);
}

console.log(
  `assert-no-wasm: ${scanned} file(s) scanned, no WebAssembly found.`
);
