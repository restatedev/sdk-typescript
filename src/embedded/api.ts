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

import { ServiceApi } from "../context";
import { doInvoke } from "./invocation";
import crypto from "crypto";
import { RemoteContext } from "../generated/proto/services";
import { bufConnectRemoteContext } from "./http2_remote";
import { OutgoingHttpHeaders } from "http";
import { Client, TerminalError } from "../public_api";
import { EndpointImpl } from "../endpoint/endpoint_impl";
import { RpcRequest } from "../generated/proto/dynrpc";
import { requestFromArgs } from "../utils/assumptions";

export type RestateConnectionOptions = {
  /**
   * Additional headers attached to the requests sent to Restate.
   */
  headers: OutgoingHttpHeaders;
};

export type RestateInvocationOptions = {
  /**
   * Retention period for the response in seconds.
   * After the invocation completes, the response will be persisted for the given duration.
   * Afterward, the system will clean up the response and treats any subsequent invocation with same operation_id as new.
   *
   * If not set, 30 minutes will be used as retention period.
   */
  retain?: number;

  idempotencyKey: string;
};

export const connection = (
  address: string,
  endpoints: EndpointImpl,
  opt?: RestateConnectionOptions
): RestateConnection =>
  new RestateConnection(endpoints, bufConnectRemoteContext(address, opt));

export class RestateConnection {
  constructor(
    private readonly endpoints: EndpointImpl,
    private readonly remote: RemoteContext
  ) {}

  public rpc<M>(api: ServiceApi<M>, opts: RestateInvocationOptions): Client<M> {
    const clientProxy = new Proxy(
      {},
      {
        get: (_target, prop) => {
          const route = prop as string;
          return async (...args: unknown[]) => {
            //
            // back to gRPC world
            //
            const service = api.path;
            const methodName = route;
            const url = `/invoke/${service}/${methodName}`;
            const method = this.endpoints.methodByUrl(url);
            if (!method) {
              throw new TerminalError(`type error`); // TODO: complete
            }
            //
            // back to the handler world
            //
            const arg = RpcRequest.encode(
              requestFromArgs(args)
            ).finish() as Buffer;
            //
            // make the emb handler call
            //
            const streamId = crypto.randomUUID();
            return doInvoke(
              this.remote,
              opts.idempotencyKey,
              streamId,
              arg,
              method,
              opts
            );
          };
        },
      }
    );

    return clientProxy as Client<M>;
  }
}
