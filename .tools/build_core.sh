#!/usr/bin/env bash

SELF_PATH=${BASH_SOURCE[0]:-"$(command -v -- "$0")"}
PROJECT_ROOT="$(cd "$(dirname "$SELF_PATH")/.." && pwd)"

# For core sdk
pushd $PROJECT_ROOT/sdk-shared-core-wasm-bindings
wasm-pack build --target web
node $PROJECT_ROOT/.tools/wasm_inline.js

# Cloudflare sdk
wasm-pack build --target bundler -d ../packages/libs/restate-sdk-cloudflare-workers/patches/vm
popd
