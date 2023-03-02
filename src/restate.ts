"use strict";

import { ProtoMetadata, parseService } from "./types";
import { incomingConnectionAtPort } from "./bidirectional_server";
import { HostedGrpcServiceMethod } from "./core";
import {
  DurableExecutionContext,
  DurableExecutionStateMachine,
} from "./durable_execution";

export interface ServiceOpts {
  descriptor: ProtoMetadata;
  service: string;
  instance: unknown;
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
      const url = `/${spec.packge}.${spec.name}/${method.name}`;
      this.methods[url] = new HostedGrpcServiceMethod(instance, method);
      // note that this log will not print all the keys.
      console.log(
        `Registering: ${url}  -> ${JSON.stringify(method, null, "\t")}`
      );
    }
    return this;
  }

  methodByUrl<I, O>(
    url: string | undefined | null
  ): HostedGrpcServiceMethod<I, O> | undefined {
    if (url == undefined || url === null) {
      return undefined;
    }
    const method = this.methods[url];
    if (method === null || method === undefined) {
      return undefined;
    }
    return method as HostedGrpcServiceMethod<I, O>;
  }

  public async listen(port: number) {
    console.log(`listening on ${port}...`);

    for await (const connection of incomingConnectionAtPort(port)) {
      const method = this.methodByUrl(connection.url.path);
      if (method === undefined) {
        console.log(`INFO no service found for URL ${connection.url.path}`);
        connection.respond404();
      } else {
        console.log(`INFO new stream for ${connection.url.path}`);
        connection.respondOk();
        new DurableExecutionStateMachine(connection, method);
      }
    }
  }

  public async fakeInvoke(url: string, buf: Uint8Array): Promise<Uint8Array> {
    return await this.methods[url].invoke(new DurableExecutionContext(), buf);
  }
}
