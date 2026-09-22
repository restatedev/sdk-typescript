#!/usr/bin/env bash

if [[ ! -d ../restate-sdk/dist ]]; then
  echo "ERROR - You need to build the restate-sdk module first!"
  exit 1
fi

cp -r ../restate-sdk/dist .

# Copy fetch.js
cp patches/fetch.js dist/fetch.js

# Replace the vm dir with the Cloudflare (napi wasm) variant: the deferred workerd loader, the
# threadless wasm32-wasip1 module, a top-level-await selector (index.js), and the LogLevel /
# bundler-patch shim (sdk_shared_core_wasm_bindings.js).
rm -r dist/endpoint/handlers/vm
cp -r patches/vm dist/endpoint/handlers
rm -f dist/endpoint/handlers/vm/.gitignore
