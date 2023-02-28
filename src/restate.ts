"use strict";

import { GrpcServiceMethod, ProtoMetadata, parseService } from "./types";

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
    const input = this.method.inputDecoder(inBytes);
    const output = await this.method.localFn(input);
    return this.method.outputEncoder(output);
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

  public async listen(port: number) {
    // hello
  }

  public async fakeInvoke(url: string, buf: Uint8Array): Promise<Uint8Array> {
    return await this.methods[url].invoke(buf);
  }
}
