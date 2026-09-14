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

// Replaces the shared-core backend selector of @restatedev/restate-sdk.
//
// Cloudflare Workers always provide WebAssembly, so there is nothing to select:
// bind the shared-core surface straight to the workerd WASM entrypoint. This
// also keeps the pure TypeScript shared core out of the worker bundle.
export {
  WasmHeader,
  WasmIdentityVerifier,
  WasmVM,
  cancel_handle,
  set_log_level,
} from "./sdk_shared_core_wasm_bindings.js";

export const sharedCoreKind = "wasm";
