"use strict";

import {
  GrpcService,
  ProtoMetadata,
  parseService,
} from "./types";

export interface ServiceOpts {
  descriptor: ProtoMetadata;
  service: string;
  instance: unknown;
}

export class Restate {
  public readonly services: Record<string, GrpcService> = {};

  bind({ descriptor, service, instance: instnace }: ServiceOpts): Restate {
    const spec = parseService(descriptor, service, instnace);
    // note that this log will not print all the keys.
    console.log(`Registering ${JSON.stringify(spec, null, "\t")}`);
    this.services[service] = spec;

    return this;
  }

  async listen(port: number) {
    // hello
  }
}
