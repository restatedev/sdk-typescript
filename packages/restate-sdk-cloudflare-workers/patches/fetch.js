/*
 * Copyright (c) 2023-2024 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */
export * from "./common_api.js";
import { FetchEndpointImpl, } from "./endpoint/fetch_endpoint.js";
import { ProtocolMode } from "./types/discovery.js";
import { cloudflareWorkersBundlerPatch } from "./endpoint/handlers/vm/sdk_shared_core_wasm_bindings.js"
/**
 * Create a new {@link RestateEndpoint} in request response protocol mode.
 * Bidirectional mode (must be served over http2) can be enabled with .enableHttp2()
 */
export function endpoint() {
    cloudflareWorkersBundlerPatch()
    return new FetchEndpointImpl(ProtocolMode.REQUEST_RESPONSE);
}
//# sourceMappingURL=fetch.js.map