import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PKG_DIR = join(ROOT, "sdk-shared-core-wasm-bindings/pkg");
const OUT_DIR = join(
  ROOT,
  "packages/libs/restate-sdk/src/endpoint/handlers/vm"
);
const OUT_NAME = "sdk_shared_core_wasm_bindings";

const wasmName = readdirSync(PKG_DIR).find((f) => f.endsWith("_bg.wasm"));
const projectName = wasmName.replace("_bg.wasm", "");

const wasmBase64 = readFileSync(join(PKG_DIR, wasmName)).toString("base64");
let js = readFileSync(join(PKG_DIR, `${projectName}.js`), "utf8");
let dts = readFileSync(join(PKG_DIR, `${projectName}.d.ts`), "utf8");

// Trim .d.ts: everything from InitInput onwards is init-related boilerplate
const dtsDelIdx = dts.indexOf("export type InitInput");
if (dtsDelIdx !== -1) dts = dts.slice(0, dtsDelIdx);

// Keep only the bindings — drop __wbg_load, initSync, __wbg_init, and the export line.
// Everything before __wbg_load already includes __wbg_get_imports and __wbg_finalize_init.
const loadIdx = js.indexOf("async function __wbg_load(");
if (loadIdx === -1)
  throw new Error("Could not find __wbg_load in generated JS");
js = js.slice(0, loadIdx).trimEnd();

const DECODER = `\
function __decode_base64__(base64) {
  if (typeof Uint8Array.fromBase64 === "function") {
    return Uint8Array.fromBase64(base64);
  }
  return Buffer.from(base64, "base64");
}`;

const INIT_SYNC = `\
function initSync() {
    if (wasm !== undefined) return wasm;
    const bytes = __decode_base64__(__wasm_base64__);
    const module = new WebAssembly.Module(bytes);
    const imports = __wbg_get_imports();
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

initSync();`;

const output = [
  `const __wasm_base64__ = "${wasmBase64}";`,
  "",
  DECODER,
  "",
  js,
  "",
  INIT_SYNC,
  "",
].join("\n");

writeFileSync(join(OUT_DIR, `${OUT_NAME}.js`), output);
writeFileSync(join(OUT_DIR, `${OUT_NAME}.d.ts`), dts);
console.log(
  `Wrote ${OUT_NAME}.js (${(output.length / 1024).toFixed(0)} KB) and ${OUT_NAME}.d.ts`
);
