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

# Provide the vm selector entrypoint the SDK sources import (`./vm/index.js`).
# On Cloudflare Workers there is no native addon, so it simply re-exports the
# workerd WASM bindings copied just above. `registerLogCallbacks` is a
# native-only export; declare it (as undefined) so the named import in
# generic.js resolves and its optional call no-ops.
cat > dist/endpoint/handlers/vm/index.js <<'EOF'
export * from "./sdk_shared_core_wasm_bindings.js";
export const registerLogCallbacks = undefined;
EOF
cat > dist/endpoint/handlers/vm/index.d.ts <<'EOF'
export * from "./sdk_shared_core_wasm_bindings.js";
export declare const registerLogCallbacks: undefined;
EOF
