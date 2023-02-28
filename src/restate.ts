"use strict";

import { GrpcServiceMethod, ProtoMetadata, parseService } from "./types";
import { GrpcRestateContext, RestateContext, setContext } from "./context";

export interface ServiceOpts {
  descriptor: ProtoMetadata;
  service: string;
  instance: unknown;
}

class HostedGrpcServiceMethod<I, O> {
  constructor(
    readonly instance: unknown,
    readonly method: GrpcServiceMethod<I, O>
  ) {}

  async invoke(inBytes: Uint8Array): Promise<Uint8Array> {
    const context = new GrpcRestateContext();
    const instanceWithContext = setContext(this.instance, context);

    const input = this.method.inputDecoder(inBytes);
    const output = await this.method.localFn(instanceWithContext, input);
    const outBytes = this.method.outputEncoder(output);

    // TODO: do something with the context
    // for example collect the final side effects, etc.

    return outBytes;
  }
}

export function createServer(): RestateServer {
  return new RestateServer();
}

export class RestateServer {
  readonly methods: Record<string, HostedGrpcServiceMethod<unknown, unknown>> =
    {};

  public bindService({
    descriptor,
    service,
    instance: instance,
  }: ServiceOpts): RestateServer {
    const spec = parseService(descriptor, service, instance);
    for (const method of spec.methods) {
      const url = `${spec.packge}.${spec.name}/${method.name}`;
      this.methods[url] = new HostedGrpcServiceMethod(instance, method);
      // note that this log will not print all the keys.
      console.log(
        `Registering: ${url}  -> ${JSON.stringify(method, null, "\t")}`
      );
    }
    return this;
  }

  methodByUrl<I, O>(url: string): HostedGrpcServiceMethod<I, O> | null {
    const method = this.methods[url];
    if (method === null || method === undefined) {
      return null;
    }
    return method as HostedGrpcServiceMethod<I, O>;
  }

  public async listen(port: number) {
    console.log(`Listening on port ${port} ...`);
  }

  public async fakeInvoke(url: string, buf: Uint8Array): Promise<Uint8Array> {
    return await this.methods[url].invoke(buf);
  }
}
