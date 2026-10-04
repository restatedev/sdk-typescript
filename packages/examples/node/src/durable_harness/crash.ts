/*
 * Copyright (c) 2023-2024 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

// Crash injection for the recovery tests: `arm(name)` makes the next `crashpoint(name)` kill the process.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";

const dir = process.env.HARNESS_TEST_DIR ?? "/tmp/durable-harness";
mkdirSync(dir, { recursive: true });

export function arm(name: string) {
  appendFileSync(join(dir, `arm-${name}`), "");
}

export function crashpoint(name: string) {
  const marker = join(dir, `arm-${name}`);
  if (existsSync(marker)) {
    rmSync(marker);
    console.log(`CRASH at ${name}`);
    process.exit(1);
  }
}

/** Records an external side effect, so tests can count how many times it happened. */
export function sideEffect(name: string) {
  appendFileSync(join(dir, `effects-${name}`), "x");
}

export function sideEffects(name: string): number {
  const file = join(dir, `effects-${name}`);
  return existsSync(file) ? readFileSync(file, "utf8").length : 0;
}
