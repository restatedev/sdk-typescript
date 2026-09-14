#!/usr/bin/env bash

if [[ ! -d ../restate-sdk/dist ]]; then
  echo "ERROR - You need to build the restate-sdk module first!"
  exit 1
fi

cp -r ../restate-sdk/dist .

# Copy fetch.js
cp patches/fetch.js dist/fetch.js

# Swap the shared core for the workerd WASM build.
#
# The TypeScript shared core is only needed on runtimes without WebAssembly,
# so it is dropped here, together with the backend selector that would pick
# between the two (patches/index.js binds straight to the WASM build).
rm -rf dist/endpoint/handlers/vm/ts
rm -f dist/endpoint/handlers/vm/sdk_shared_core_wasm_bindings.*

# Copy vm
cp -r patches/vm/. dist/endpoint/handlers/vm/

# Copy vm entrypoint and the selector replacement
cp patches/sdk_shared_core_wasm_bindings.js dist/endpoint/handlers/vm/
cp patches/index.js dist/endpoint/handlers/vm/index.js
