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
 * The shared-core binding used by the `lite` entry points
 * (`@restatedev/restate-sdk/lite` and friends).
 *
 * It is the twin of `./index.ts`, with the backend selection removed: there is
 * nothing to select, because this module never imports the WASM build. That is
 * the whole point of the `lite` entries. A static import of the WASM glue would
 * pull its payload into the bundle even though it is never instantiated, and on
 * a runtime without WebAssembly the file may not even be parseable.
 *
 * `tsdown.lite.config.ts` redirects every internal import of `./vm/index.js` to
 * this module, so the two entry families share source but not this seam. Its
 * export list must therefore stay in step with `./index.ts`.
 */

import { setLogSink, tsBindings } from "./ts/bindings.js";
import { vm_log } from "../core_logging.js";
import type {
  LogLevel as LogLevelType,
  WasmHeader as WasmHeaderType,
  WasmHeaderConstructor,
  WasmIdentityVerifier as WasmIdentityVerifierType,
  WasmIdentityVerifierConstructor,
  WasmVM as WasmVMType,
  WasmVMConstructor,
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

setLogSink((level, message, loggerId) => vm_log(level, message, loggerId));

/** Which shared-core implementation is in use. Always `"ts"` here. */
export const sharedCoreKind: SharedCoreKind = "ts";

export const WasmVM: WasmVMConstructor = tsBindings.WasmVM;
export type WasmVM = WasmVMType;

export const WasmHeader: WasmHeaderConstructor = tsBindings.WasmHeader;
export type WasmHeader = WasmHeaderType;

export const WasmIdentityVerifier: WasmIdentityVerifierConstructor =
  tsBindings.WasmIdentityVerifier;
export type WasmIdentityVerifier = WasmIdentityVerifierType;

export function set_log_level(level: LogLevelType): void {
  tsBindings.set_log_level(level);
}

export function cancel_handle(): number {
  return tsBindings.cancel_handle();
}
