import * as imports from "./sdk_shared_core_wasm_bindings_bg.js";

// switch between both syntax for node and for workerd
import wkmod from "./sdk_shared_core_wasm_bindings_bg.wasm";

const instance = new WebAssembly.Instance(wkmod, {
    "./sdk_shared_core_wasm_bindings_bg.js": imports,
});
imports.__wbg_set_wasm(instance.exports);

export * from "./sdk_shared_core_wasm_bindings_bg.js";

instance.exports.__wbindgen_start();

export function cloudflareWorkersBundlerPatch() {
    // This is the result of many hours of debugging.
    // The patch described here https://developers.cloudflare.com/workers/languages/rust/#javascript-plumbing-wasm-bindgen
    // won't "just work", because the CF worker bundler has some bug that will eliminate this file.
    // To prevent the elimination, we call this empty function from the fetch.js file, which is the user entrypoint of the SDK.
}