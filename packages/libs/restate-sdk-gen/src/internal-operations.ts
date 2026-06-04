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

// Internal operations
// =============================================================================
//
// Free-standing functions that are deliberately NOT part of the main
// API surface (`free.ts` / top-level `index.ts` exports). They expose
// sharp tools whose misuse leads straight to non-determinism errors,
// so they live behind the `internal` namespace as an "I know what I'm
// doing" gate:
//
//   import { internal } from "@restatedev/restate-sdk-gen";
//   if (internal.isProcessing()) { ... }

import { peekCurrent } from "./current.js";
import { RestateOperations } from "./restate-operations.js";

/**
 * Whether the current invocation is in the processing phase (as opposed
 * to replaying its journal). Aligns with the core SDK's
 * `ContextInternal.isProcessing()`.
 *
 * Returns `true`/`false` when called inside an active fiber backed by a
 * real Restate context, and `undefined` when there is no such context
 * (outside `execute()`, or in scheduler-only tests with no SDK context).
 *
 * **WARNING**: this is the same mechanism `ctx.console` uses to decide
 * whether to log during replay. Do **not** use it to influence control
 * flow — doing so will **surely** lead to non-determinism errors. It is
 * intended for observability concerns only (logging, metrics).
 *
 * @experimental
 */
export function isProcessing(): boolean | undefined {
  const current = peekCurrent();
  return current instanceof RestateOperations
    ? current.isProcessing()
    : undefined;
}
