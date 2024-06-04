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

import { Http2ServerRequest, Http2ServerResponse } from "http2";
import { endpointImpl } from "./endpoint/endpoint_impl";
import type {
  VirtualObjectDefinition,
  ServiceDefinition,
  WorkflowDefinition,
} from "@restatedev/restate-sdk-core";

/**
 * Create a new {@link RestateEndpoint}.
 */
export function endpoint(): RestateEndpoint {
  return endpointImpl();
}

/**
 * Utility interface for a bundle of one or more services belonging together
 * and being registered together.
 */
export interface ServiceBundle {
  /**
   * Called to register the services at the endpoint.
   */
  registerServices(endpoint: RestateEndpoint): void;
}

/**
 * RestateEndpoint encapsulates all the Restate services served by this endpoint.
 *
 * A RestateEndpoint can either be served either as HTTP2 server, using the methods {@link listen} or {@link http2Handler},
 * or as Lambda, using the method {@link lambdaHandler}.
 *
 * @example
 * A typical endpoint served as HTTP server would look like this:
 * ```
 * import * as restate from "@restatedev/restate-sdk";
 *
 * restate
 *   .endpoint()
 *   .bind(myService)
 *   .listen(8000);
 * ```
 * @example
 * A typical endpoint served as AWS Lambda would look like this:
 * ```
 * import * as restate from "@restatedev/restate-sdk";
 *
 * export const handler = restate
 *   .endpoint()
 *   .bind(myService)
 *   .lambdaHandler();
 * ```
 */
export interface RestateEndpoint {
  /**
   * Binds a new durable service / virtual object / workflow.
   *
   * see restate.service, restate.object, and restate.workflow for more details.
   **/
  bind<P extends string, M>(
    service:
      | ServiceDefinition<P, M>
      | VirtualObjectDefinition<P, M>
      | WorkflowDefinition<P, M>
  ): RestateEndpoint;

  /**
   * Adds one or more services to this endpoint. This will call the
   * {@link ServiceBundle.registerServices} function to register all services at this endpoint.
   */
  bindBundle(services: ServiceBundle): RestateEndpoint;

  /**
   * Provide a list of v1 request identity public keys eg `publickeyv1_2G8dCQhArfvGpzPw5Vx2ALciR4xCLHfS5YaT93XjNxX9` to validate
   * incoming requests against, limiting requests to Restate clusters with the corresponding private keys. This public key format is
   * logged by the Restate process at startup if a request identity private key is provided.
   *
   * If this function is called, all incoming requests irrelevant of endpoint type will be expected to have
   * `x-restate-signature-scheme: v1` and `x-restate-jwt-v1: <valid jwt signed with one of these keys>`. If not called,
   *
   */
  withIdentityV1(...keys: string[]): RestateEndpoint;

  /**
   * Creates the invocation handler function to be called by AWS Lambda.
   *
   * The returned type of this function is `(event: APIGatewayProxyEvent | APIGatewayProxyEventV2) => Promise<APIGatewayProxyResult | APIGatewayProxyResultV2>`.
   * We use `any` types here to avoid a dependency on the `@types/aws-lambda` dependency for consumers of this API.
   *
   * @returns The invocation handler function for to be called by AWS Lambda.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lambdaHandler(): (event: any, ctx: any) => Promise<any>;

  /**
   * Serve this Restate Endpoint as HTTP2 server, listening to the given port.
   *
   * If the port is undefined, this method will use the port set in the `PORT`
   * environment variable. If that variable is undefined as well, the method will
   * default to port 9080.
   *
   * This method's result promise never completes.
   *
   * This method is a shorthand for:
   *
   * @example
   * ```
   * const httpServer = http2.createServer(endpoint.http2Handler());
   * httpServer.listen(port);
   * ```
   *
   * If you need to manually control the server lifecycle, we suggest to manually instantiate the http2 server and use {@link http2Handler}.
   *
   * @param port The port to listen at. May be undefined (see above).
   * @returns a Promise that resolves with the bound port, or rejects with a failure otherwise.
   */
  listen(port?: number): Promise<number>;

  /**
   * Returns an http2 server handler. See {@link listen} for more details.
   */
  http2Handler(): (
    request: Http2ServerRequest,
    response: Http2ServerResponse
  ) => void;
}
