#!/usr/bin/env bash
set -euo pipefail

# Regenerates the shared core. The core is the napi-rs crate in
# packages/libs/restate-sdk-shared-core-native:
#   - Node/Deno/Bun use the native .node addon (built by that package's normal `build`);
#   - Cloudflare Workers / edge use the same crate compiled to threadless wasm32-wasip1, loaded on
#     workerd via the deferred loader. We build that wasm here and stage it into restate-sdk's vm
#     dir, where it is picked up by the `#vm` "workerd"/"worker"/"edge-light" conditional import
#     (index.workerd.js there is hand-written and committed).

SELF_PATH=${BASH_SOURCE[0]:-"$(command -v -- "$0")"}
PROJECT_ROOT="$(cd "$(dirname "$SELF_PATH")/.." && pwd)"

NATIVE="$PROJECT_ROOT/packages/libs/restate-sdk-shared-core-native"
SDK_VM="$PROJECT_ROOT/packages/libs/restate-sdk/src/endpoint/handlers/vm"

pushd "$NATIVE"
pnpm run build:wasm
cp wasm-out/restate-sdk-shared-core-native.wasm32-wasip1.wasm "$SDK_VM/shared_core.wasm"
cp wasm-out/restate-sdk-shared-core-native.wasip1-deferred.js "$SDK_VM/wasi_loader.js"
popd
