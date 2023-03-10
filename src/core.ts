"use strict";

import { RestateContext, setContext } from "./context";
import { GrpcServiceMethod } from "./types";

export class HostedGrpcServiceMethod<I, O> {
  constructor(
    readonly instance: unknown,
    readonly service: string,
    readonly method: GrpcServiceMethod<I, O>
  ) {}

  async invoke(
    context: RestateContext,
    inBytes: Uint8Array
  ): Promise<Uint8Array> {
    const instanceWithContext = setContext(this.instance, context);
    const input = this.method.inputDecoder(inBytes);
    const output = await this.method.localFn(instanceWithContext, input);
    const outBytes = this.method.outputEncoder(output);
    return outBytes;
  }
}
