#!/usr/bin/env bash

if [[ ! -d ../restate-sdk/dist ]]; then
  echo "ERROR - You need to build the restate-sdk module first!"
  exit 1
fi

cp -r ../restate-sdk/dist .

# Copy fetch.js
cp patches/fetch.js dist/fetch.js

# Copy vm
rm -r dist/endpoint/handlers/vm
cp -r patches/vm dist/endpoint/handlers

# Copy vm entrypoint
cp patches/sdk_shared_core_wasm_bindings.js dist/endpoint/handlers/vm
