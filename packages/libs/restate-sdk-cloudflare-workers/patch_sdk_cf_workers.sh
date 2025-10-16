#!/usr/bin/env bash

if [[ ! -d ../restate-sdk/dist ]]; then
  echo "ERROR - You need to build the restate-sdk module first!"
  exit 1
fi

cp -r ../restate-sdk/dist .
rm -r dist/cjs

# Copy fetch.js
cp patches/fetch.js dist/esm/src/fetch.js

# Copy vm
rm -r dist/esm/src/endpoint/handlers/vm
cp -r patches/vm dist/esm/src/endpoint/handlers

# Copy vm entrypoint
cp patches/sdk_shared_core_wasm_bindings.js dist/esm/src/endpoint/handlers/vm