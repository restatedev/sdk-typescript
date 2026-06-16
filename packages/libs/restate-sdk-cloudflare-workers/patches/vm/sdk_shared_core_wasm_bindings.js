/* @ts-self-types="./sdk_shared_core_wasm_bindings.d.ts" */
import * as wasm from "./sdk_shared_core_wasm_bindings_bg.wasm";
import { __wbg_set_wasm } from "./sdk_shared_core_wasm_bindings_bg.js";

__wbg_set_wasm(wasm);
wasm.__wbindgen_start();
export {
    LogLevel, WasmCommandType, WasmHeader, WasmIdentityVerifier, WasmInput, WasmJournalMismatchBehavior, WasmResponseHead, WasmVM, cancel_handle, set_log_level, start
} from "./sdk_shared_core_wasm_bindings_bg.js";
