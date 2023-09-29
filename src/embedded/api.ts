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

export type RestateConnectionOptions = {
  ingress: string;
};

export type RestateInvocationOptions<I, O> = {
  id: string;
  handler: (ctx: RpcContext, input: I) => Promise<O>;
  input: I;
  retain?: number;
};

export const connection = (opts: RestateConnectionOptions): RestateConnection =>
  new RestateConnection(opts);

export class RestateConnection {
  private remote: RemoteContext;

  constructor(readonly opts: RestateConnectionOptions) {
    this.remote = bufConnectRemoteContext(opts.ingress);
  }

  public invoke<I, O>(opt: RestateInvocationOptions<I, O>): Promise<O> {
    const method = wrapHandler(opt.handler);
    const streamId = crypto.randomUUID();
    return doInvoke<I, O>(this.remote, opt.id, streamId, method, opt.input);
  }
}
