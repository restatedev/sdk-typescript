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

// Shared-core loader for Cloudflare Workers / edge runtimes (the `workerd` / `worker` / `edge-light`
// condition of the `#vm` subpath import).
//
// These runtimes have no native addon; instead we run the SAME napi crate compiled to threadless
// `wasm32-wasip1`, instantiated on workerd via napi-rs's deferred loader (`WebAssembly.instantiate`).
// `import mod from './shared_core.wasm'` gives the runtime a precompiled `WebAssembly.Module`
// (CompiledWasm module rule). `instantiate()` is async, so this module uses top-level await to prime
// the binding once, before any request handler runs.
import mod from "./shared_core.wasm";
import { instantiate } from "./wasi_loader.js";
import { fatal, vm_log } from "../core_logging.js";

const __raw = await instantiate(mod);
const impl = __raw && __raw.exports ? __raw.exports : __raw;

// Hand the SDK's logging functions to the wasm module (fires synchronously, on the JS thread).
impl.registerLogCallbacks?.(vm_log, fatal);

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
