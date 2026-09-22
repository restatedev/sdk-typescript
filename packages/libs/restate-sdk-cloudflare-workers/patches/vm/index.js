// Cloudflare Workers shared-core selector (napi-rs wasm).
//
// Replaces the Node/Deno/Bun selector (`restate-sdk/src/endpoint/handlers/vm/index.ts`) at package
// time. On Workers there is no native napi addon; instead we run the SAME napi crate compiled to
// threadless `wasm32-wasip1`, instantiated on workerd via `WebAssembly.instantiate` through
// napi-rs's deferred loader (which imports `@napi-rs/wasm-runtime` + `@emnapi/runtime`).
//
// `import mod from './*.wasm'` gives workerd a precompiled `WebAssembly.Module` (wrangler
// CompiledWasm module rule). `instantiate()` is async, so this module uses top-level await to
// prime the binding once, before any request handler runs.
import mod from "./restate-sdk-shared-core-native.wasm32-wasip1.wasm";
import { instantiate } from "./restate-sdk-shared-core-native.wasip1-deferred.js";
import { fatal, vm_log } from "../core_logging.js";

const __raw = await instantiate(mod);
const impl = __raw && __raw.exports ? __raw.exports : __raw;

// Hand the SDK's logging functions to the wasm module (fires synchronously, on the JS thread).
impl.registerLogCallbacks?.(vm_log, fatal);

export const WasmVM = impl.WasmVM;
export const WasmHeader = impl.WasmHeader;
export const WasmInput = impl.WasmInput;
export const WasmResponseHead = impl.WasmResponseHead;
export const WasmIdentityVerifier = impl.WasmIdentityVerifier;
export const LogLevel = impl.LogLevel;
export const WasmCommandType = impl.WasmCommandType;
export const WasmJournalMismatchBehavior = impl.WasmJournalMismatchBehavior;
export const cancel_handle = impl.cancel_handle;
export const set_log_level = impl.set_log_level;
export const start = impl.start;
