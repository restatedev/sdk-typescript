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

/**
 * Shared-core loader for Node.js / Deno / Bun.
 *
 * The Restate shared core is a Rust crate compiled with napi-rs. Here we load its **native addon**
 * (`@restatedev/restate-sdk-shared-core-native`). This is the default target of the `#vm` subpath
 * import; on Cloudflare Workers / edge the `workerd` / `worker` / `edge-light` condition resolves
 * `#vm` to `./index.workerd.js` instead, which runs the same crate compiled to wasm.
 *
 * The runtime *values* below come from the addon; the *types* come from its generated declarations.
 * The addon still names its classes `Wasm*` internally (a distinct Rust identifier is needed next to
 * the shared-core's own `Header`, `Failure`, ... types); this module re-exports them without that
 * prefix, which is the surface the rest of the SDK uses.
 */

import { createRequire } from "node:module";
import type * as Native from "@restatedev/restate-sdk-shared-core-native";
import { fatal, vm_log } from "../core_logging.js";

/** The shared-core surface (the native `.d.ts` already declares `registerLogCallbacks`). */
type SharedCore = typeof Native;

const NATIVE_PACKAGE = "@restatedev/restate-sdk-shared-core-native";

function loadSharedCore(): SharedCore {
  // Always go through `createRequire` (not a bare `require`): a bundler would otherwise rewrite
  // `require` to its own CJS-interop shim, which does not resolve node_modules packages under Deno.
  const req = createRequire(import.meta.url);
  let native: SharedCore;
  try {
    native = req(NATIVE_PACKAGE) as SharedCore;
  } catch (e) {
    throw new Error(
      `Failed to load the Restate shared-core native addon ('${NATIVE_PACKAGE}') for this ` +
        `platform. Cause: ${e instanceof Error ? e.message : String(e)}`
    );
  }
  // Hand the SDK's logging functions to the native addon (fires synchronously, on the JS thread).
  native.registerLogCallbacks(vm_log, fatal);
  return native;
}

const impl = loadSharedCore();

// --- Runtime values (classes / enums / functions) ---

export const VM = impl.WasmVM;
export const Header = impl.WasmHeader;
export const Input = impl.WasmInput;
export const ResponseHead = impl.WasmResponseHead;
export const IdentityVerifier = impl.WasmIdentityVerifier;
export const LogLevel = impl.LogLevel;
export const CommandType = impl.WasmCommandType;
export const JournalMismatchBehavior = impl.WasmJournalMismatchBehavior;
export const cancel_handle = impl.cancel_handle;
export const set_log_level = impl.set_log_level;
export const start = impl.start;

// --- Types ---

// Class / enum names need both a value (above) and a type (here).
export type VM = Native.WasmVM;
export type Header = Native.WasmHeader;
export type Input = Native.WasmInput;
export type ResponseHead = Native.WasmResponseHead;
export type IdentityVerifier = Native.WasmIdentityVerifier;
export type LogLevel = Native.LogLevel;
export type CommandType = Native.WasmCommandType;
export type JournalMismatchBehavior = Native.WasmJournalMismatchBehavior;

export type {
  WasmAwakeable as Awakeable,
  WasmCallHandle as CallHandle,
  WasmExponentialRetryConfig as ExponentialRetryConfig,
  WasmFailure as Failure,
  WasmFailureMetadata as FailureMetadata,
  WasmRun as Run,
  WasmSendHandle as SendHandle,
} from "@restatedev/restate-sdk-shared-core-native";

// Externally-tagged unions the napi binding types as `any` / `unknown`; declared here to match the
// Rust surface (see the shared-core crate).
export type AsyncResultValue =
  | "NotReady"
  | "Empty"
  | { Success: Uint8Array }
  | { Failure: Native.WasmFailure }
  | { StateKeys: string[] }
  | { InvocationId: string };

export type DoProgressResult =
  | "AnyCompleted"
  | "WaitExternalProgress"
  | { ExecuteRun: number }
  | "CancelSignalReceived";

export type UnresolvedFuture =
  | { Single: number }
  | { FirstCompleted: UnresolvedFuture[] }
  | { AllCompleted: UnresolvedFuture[] }
  | { FirstSucceededOrAllFailed: UnresolvedFuture[] }
  | { AllSucceededOrFirstFailed: UnresolvedFuture[] }
  | { Unknown: UnresolvedFuture[] };
