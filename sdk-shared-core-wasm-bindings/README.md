To build:

* wasm-pack build --target web
* npx wasm-pack-inline ./pkg --dir ../packages/restate-sdk/src/endpoint/handlers/vm --name sdk_shared_core_wasm_bindings
