#!/usr/bin/env bash

SELF_PATH=${BASH_SOURCE[0]:-"$(command -v -- "$0")"}
PROJECT_ROOT="$(dirname "$SELF_PATH")/.."

pushd $PROJECT_ROOT/sdk-shared-core-wasm-bindings
wasm-pack build --target web
npx wasm-pack-inline ./pkg --dir ../packages/libs/restate-sdk/src/endpoint/handlers/vm --name sdk_shared_core_wasm_bindings
wasm-pack build --target bundler -d ../packages/libs/restate-sdk-cloudflare-workers/patches/vm
popd
