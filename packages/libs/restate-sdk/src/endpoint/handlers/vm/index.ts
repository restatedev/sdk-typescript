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

/**
 * Shared-core binding selector.
 *
 * The Restate shared-core state machine ships in two flavors that expose the
 * exact same JS surface:
 *
 *  - a WASM build (`./sdk_shared_core_wasm_bindings.js`), bundled into this
 *    package and used on every runtime;
 *  - a napi native addon (`@restatedev/restate-sdk-shared-core-native`), used
 *    only on Node to escape the wasm32 memory ceiling and avoid buffer copies.
 *
 * On Node we try to load the native addon (published as per-platform prebuilt
 * binaries via optional dependencies) and transparently fall back to the WASM
 * build when it is unavailable. Every other runtime (Bun, Deno, Cloudflare
 * Workers, edge, browser) keeps using the WASM build. The Cloudflare Workers
 * package replaces this whole `vm/` directory at build time with a workerd
 * WASM entrypoint, so this selector never runs there.
 *
 * The choice can be forced with `RESTATE_SHARED_CORE=native|wasm`.
 */

import { createRequire } from "node:module";
import * as wasmBindings from "./sdk_shared_core_wasm_bindings.js";

/** Callback invoked by the shared-core to emit a log record. */
export type LogCallback = (
  level: wasmBindings.LogLevel,
  message: Uint8Array,
  loggerId?: number
) => void;
/** Callback invoked by the shared-core panic hook. */
export type FatalCallback = (message: string) => void;

/**
 * The native addon exposes the same surface as the WASM build, plus a
 * `registerLogCallbacks` hook. The WASM build instead statically imports the
 * log callbacks via wasm-bindgen `raw_module`, so this hook is absent there.
 */
type SharedCoreBindings = typeof wasmBindings & {
  registerLogCallbacks?: (log: LogCallback, fatal: FatalCallback) => void;
};

function loadNativeBindings(): SharedCoreBindings | undefined {
  const proc = (globalThis as { process?: NodeJS.Process }).process;
  const forced = proc?.env?.RESTATE_SHARED_CORE?.toLowerCase();
  if (forced === "wasm") {
    return undefined;
  }
  // Only Node loads the native addon; every other runtime keeps WASM.
  const isNode = proc?.release?.name === "node";
  if (!isNode && forced !== "native") {
    return undefined;
  }
  try {
    const require = createRequire(import.meta.url);
    return require("@restatedev/restate-sdk-shared-core-native") as SharedCoreBindings;
  } catch (e) {
    if (forced === "native") {
      // The user explicitly asked for native: surface the failure.
      throw e;
    }
    // No prebuilt binary for this platform: fall back to WASM.
    return undefined;
  }
}

const impl: SharedCoreBindings = loadNativeBindings() ?? wasmBindings;

// Classes and enums are re-exported as both a runtime value (from the selected
// implementation) and a type (from the canonical WASM `.d.ts`), so the existing
// `import * as vm` / `import type * as vm` consumers keep working unchanged.
const WasmVM = impl.WasmVM;
type WasmVM = wasmBindings.WasmVM;
const WasmHeader = impl.WasmHeader;
type WasmHeader = wasmBindings.WasmHeader;
const WasmIdentityVerifier = impl.WasmIdentityVerifier;
type WasmIdentityVerifier = wasmBindings.WasmIdentityVerifier;
const WasmInput = impl.WasmInput;
type WasmInput = wasmBindings.WasmInput;
const WasmResponseHead = impl.WasmResponseHead;
type WasmResponseHead = wasmBindings.WasmResponseHead;
const LogLevel = impl.LogLevel;
type LogLevel = wasmBindings.LogLevel;
const WasmCommandType = impl.WasmCommandType;
type WasmCommandType = wasmBindings.WasmCommandType;
const WasmJournalMismatchBehavior = impl.WasmJournalMismatchBehavior;
type WasmJournalMismatchBehavior = wasmBindings.WasmJournalMismatchBehavior;

const start = impl.start;
const set_log_level = impl.set_log_level;
const cancel_handle = impl.cancel_handle;
const registerLogCallbacks = impl.registerLogCallbacks;

export {
  WasmVM,
  WasmHeader,
  WasmIdentityVerifier,
  WasmInput,
  WasmResponseHead,
  LogLevel,
  WasmCommandType,
  WasmJournalMismatchBehavior,
  start,
  set_log_level,
  cancel_handle,
  registerLogCallbacks,
};

export type {
  WasmAwakeable,
  WasmCallHandle,
  WasmExponentialRetryConfig,
  WasmFailure,
  WasmFailureMetadata,
  WasmRun,
  WasmSendHandle,
  WasmAsyncResultValue,
  WasmDoProgressResult,
  WasmUnresolvedFuture,
} from "./sdk_shared_core_wasm_bindings.js";
