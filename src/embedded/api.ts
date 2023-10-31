/*
 * Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

import { RpcContext } from "../restate_context";
import { doInvoke } from "./invocation";
import { wrapHandler } from "./handler";
import crypto from "crypto";
import { RemoteContext } from "../generated/proto/services";
import { bufConnectRemoteContext } from "./http2_remote";
import { OutgoingHttpHeaders } from "http";

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
};

export const connection = (
  address: string,
  opt?: RestateConnectionOptions
): RestateConnection =>
  new RestateConnection(bufConnectRemoteContext(address, opt));

export class RestateConnection {
  constructor(private readonly remote: RemoteContext) {}

  public invoke<I, O>(
    id: string,
    input: I,
    handler: (ctx: RpcContext, input: I) => Promise<O>,
    opt?: RestateInvocationOptions
  ): Promise<O> {
    const method = wrapHandler(handler);
    const streamId = crypto.randomUUID();
    return doInvoke<I, O>(this.remote, id, streamId, input, method, opt);
  }
}
