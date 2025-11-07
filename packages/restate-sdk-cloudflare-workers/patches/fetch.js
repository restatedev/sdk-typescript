import { CancelledError, RestateError, RetryableError, TerminalError, TimeoutError } from "./types/errors.js";
import { Opts, SendOpts, handlers, object, rpc, service, workflow } from "./types/rpc.js";
import { InvocationIdParser, RestatePromise } from "./context.js";
import { CombineablePromise, createObjectHandler, createObjectSharedHandler, createServiceHandler, createWorkflowHandler, createWorkflowSharedHandler, serde } from "./common_api.js";
import { FetchEndpointImpl } from "./endpoint/fetch_endpoint.js";
import { withOptions } from "./endpoint/withOptions.js";
import { cloudflareWorkersBundlerPatch } from "./endpoint/handlers/vm/sdk_shared_core_wasm_bindings.js";

//#region src/fetch.ts
/**
* Create a new {@link RestateEndpoint} in request response protocol mode.
* Bidirectional mode (must be served over http2) can be enabled with .enableHttp2()
* @deprecated Please use {@link createEndpointHandler}
*/
function endpoint() {
  cloudflareWorkersBundlerPatch();
	return new FetchEndpointImpl("REQUEST_RESPONSE");
}

/**
 * Creates a Cloudflare worker handler that encapsulates all the Restate services served by this endpoint.
 *
 * @param options - Configuration options for the endpoint handler.
 * @returns A worker handler.
 *
 * @example
 * A typical request-response handler would look like this:
 * ```
 * import { createEndpointHandler } from "@restatedev/restate-sdk/restate-sdk-cloudflare-workers";
 *
 * export const handler = createEndpointHandler({ services: [myService] })
 *
 * @example
 * A typical bidirectional handler (works with http2 and some http1.1 servers) would look like this:
 * ```
 * import { createEndpointHandler } from "@restatedev/restate-sdk/restate-sdk-cloudflare-workers";
 *
 * export const handler = createEndpointHandler({ services: [myService], bidirectional: true })
 *
 */
function createEndpointHandler(options) {
  cloudflareWorkersBundlerPatch();
  return withOptions(
    new FetchEndpointImpl(
      options.bidirectional ? "BIDI_STREAM" : "REQUEST_RESPONSE"
    ),
    options
  ).handler().fetch;
}

//#endregion
export { CancelledError, CombineablePromise, InvocationIdParser, Opts, RestateError, RestatePromise, RetryableError, SendOpts, TerminalError, TimeoutError, createEndpointHandler, createObjectHandler, createObjectSharedHandler, createServiceHandler, createWorkflowHandler, createWorkflowSharedHandler, endpoint, handlers, object, rpc, serde, service, workflow };
//# sourceMappingURL=fetch.js.map
