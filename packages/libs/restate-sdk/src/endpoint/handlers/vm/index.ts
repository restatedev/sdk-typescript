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
 * exact same surface (see `./types.ts`):
 *
 *  - the WASM build of the Rust shared core (`./sdk_shared_core_wasm_bindings.js`),
 *    bundled into this package;
 *  - a pure TypeScript implementation (`./ts/`), used on runtimes without
 *    WebAssembly support.
 *
 * By default the WASM build is used whenever the `WebAssembly` global is
 * available, and the TypeScript implementation otherwise. The choice can be
 * forced with the `RESTATE_SHARED_CORE=wasm|ts` environment variable.
 */

import * as wasmBindings from "./sdk_shared_core_wasm_bindings.js";
import { setLogSink, tsBindings } from "./ts/bindings.js";
import { vm_log } from "../core_logging.js";
import type {
  SharedCoreBindings,
  WasmHeaderConstructor,
  WasmIdentityVerifierConstructor,
  WasmVMConstructor,
} from "./types.js";
import type {
  LogLevel as LogLevelType,
  WasmHeader as WasmHeaderType,
  WasmIdentityVerifier as WasmIdentityVerifierType,
  WasmVM as WasmVMType,
} from "./types.js";

export {
  LogLevel,
  WasmCommandType,
  WasmJournalMismatchBehavior,
} from "./types.js";
export type {
  WasmAsyncResultValue,
  WasmAwakeable,
  WasmCallHandle,
  WasmDoProgressResult,
  WasmExponentialRetryConfig,
  WasmFailure,
  WasmFailureMetadata,
  WasmInput,
  WasmResponseHead,
  WasmRun,
  WasmSendHandle,
  WasmUnresolvedFuture,
} from "./types.js";

export type SharedCoreKind = "wasm" | "ts";

function readForcedBackend(): SharedCoreKind | undefined {
  const env = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process?.env;
  const value = env?.["RESTATE_SHARED_CORE"]?.toLowerCase();
  if (value === "wasm") {
    return "wasm";
  }
  if (value === "ts" || value === "typescript") {
    return "ts";
  }
  return undefined;
}

function isWebAssemblyAvailable(): boolean {
  return (globalThis as { WebAssembly?: unknown }).WebAssembly !== undefined;
}

function loadWasmBindings(): SharedCoreBindings {
  // The inlined WASM module is instantiated lazily, so that importing the
  // module doesn't fail on runtimes without WebAssembly support.
  const maybeInit = (wasmBindings as { initSync?: () => unknown }).initSync;
  if (typeof maybeInit === "function") {
    maybeInit();
  }
  return {
    kind: "wasm",
    WasmVM: wasmBindings.WasmVM as unknown as WasmVMConstructor,
    WasmHeader: wasmBindings.WasmHeader as unknown as WasmHeaderConstructor,
    WasmIdentityVerifier:
      wasmBindings.WasmIdentityVerifier as unknown as WasmIdentityVerifierConstructor,
    set_log_level: wasmBindings.set_log_level as (level: LogLevelType) => void,
    cancel_handle: wasmBindings.cancel_handle,
  };
}

function loadTsBindings(): SharedCoreBindings {
  setLogSink((level, message, loggerId) => vm_log(level, message, loggerId));
  return tsBindings;
}

function selectBindings(): SharedCoreBindings {
  const forced = readForcedBackend();
  if (forced === "ts") {
    return loadTsBindings();
  }
  if (forced === "wasm") {
    if (!isWebAssemblyAvailable()) {
      throw new Error(
        "RESTATE_SHARED_CORE=wasm was requested, but WebAssembly is not available in this runtime"
      );
    }
    return loadWasmBindings();
  }
  return isWebAssemblyAvailable() ? loadWasmBindings() : loadTsBindings();
}

const bindings: SharedCoreBindings = selectBindings();

/** Which shared-core implementation is in use. */
export const sharedCoreKind: SharedCoreKind = bindings.kind;

export const WasmVM: WasmVMConstructor = bindings.WasmVM;
export type WasmVM = WasmVMType;

export const WasmHeader: WasmHeaderConstructor = bindings.WasmHeader;
export type WasmHeader = WasmHeaderType;

export const WasmIdentityVerifier: WasmIdentityVerifierConstructor =
  bindings.WasmIdentityVerifier;
export type WasmIdentityVerifier = WasmIdentityVerifierType;

export function set_log_level(level: LogLevelType): void {
  bindings.set_log_level(level);
}

export function cancel_handle(): number {
  return bindings.cancel_handle();
}
