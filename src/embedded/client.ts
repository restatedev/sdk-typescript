import { RpcContext } from "../restate_context";
import { go } from "./connection";
import { wrapHandler } from "./handler";
import crypto from "crypto";

export type RestateClientOpts = {
  ingress: string;
};

export type RestateClientCallOpts<I, O> = {
  id: string;
  handler: (ctx: RpcContext, input: I) => Promise<O>;
  input: I;
  retain?: number;
};

export const connection = (opts: RestateClientOpts): RestateConnection =>
  new RestateConnection(opts);

export class RestateConnection {
  public constructor(private readonly opts: RestateClientOpts) {}

  public async invoke<I, O>(opt: RestateClientCallOpts<I, O>): Promise<O> {
    const method = wrapHandler(opt.handler);
    const streamId = crypto.randomUUID();
    return await go<I, O>(
      this.opts.ingress,
      opt.id,
      streamId,
      method,
      opt.input
    );
  }
}
