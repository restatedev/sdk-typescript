"use strict";

import { parseService, ProtoMetadata } from "./types";
import { incomingConnectionAtPort } from "./bidirectional_server";
import { HostedGrpcServiceMethod } from "./core";
import { DurableExecutionStateMachine } from "./durable_execution";
import {
  ProtocolMode,
  ServiceDiscoveryResponse,
} from "./generated/proto/discovery";
import {
  FileDescriptorProto,
  UninterpretedOption,
} from "./generated/google/protobuf/descriptor";
import {
  fieldTypeToJSON,
  serviceTypeToJSON,
} from "./generated/dev/restate/ext";

export interface ServiceOpts {
  descriptor: ProtoMetadata;
  service: string;
  instance: unknown;
}

export function createServer(): RestateServer {
  return new RestateServer();
}

export abstract class BaseRestateServer {
  readonly methods: Record<string, HostedGrpcServiceMethod<unknown, unknown>> =
    {};
  readonly discovery: ServiceDiscoveryResponse;

  protected constructor(protocolMode: ProtocolMode) {
    this.discovery = {
      files: { file: [] },
      services: [],
      minProtocolVersion: 0,
      maxProtocolVersion: 0,
      protocolMode: protocolMode,
    };
  }

  addDescriptor(descriptor: ProtoMetadata) {
    const desc = FileDescriptorProto.fromPartial(descriptor.fileDescriptor);

    // extract out service options and put into the fileDescriptor
    for (const name in descriptor.options?.services) {
      if (
        descriptor.options?.services[name]?.options?.service_type !== undefined
      ) {
        desc.service
          .find((desc) => desc.name === name)
          ?.options?.uninterpretedOption.push(
            UninterpretedOption.fromPartial({
              name: [
                { namePart: "dev.restate.ext.service_type", isExtension: true },
              ],
              identifierValue: serviceTypeToJSON(
                descriptor.options?.services[name]?.options?.service_type
              ),
            })
          );
      }
    }

    // extract out field options and put into the fileDescriptor
    for (const messageName in descriptor.options?.messages) {
      for (const fieldName in descriptor.options?.messages[messageName]
        ?.fields) {
        const fields = descriptor.options?.messages[messageName]?.fields || {};
        if (fields[fieldName]["field"] !== undefined) {
          desc.messageType
            .find((desc) => desc.name === messageName)
            ?.field?.find((desc) => desc.name === fieldName)
            ?.options?.uninterpretedOption.push(
              UninterpretedOption.fromPartial({
                name: [
                  { namePart: "dev.restate.ext.field", isExtension: true },
                ],
                identifierValue: fieldTypeToJSON(fields[fieldName]["field"]),
              })
            );
        }
      }
    }

    if (
      this.discovery.files?.file.filter(
        (haveDesc) => desc.name === haveDesc.name
      ).length === 0
    ) {
      this.discovery.files?.file.push(desc);
    }
    descriptor.dependencies?.forEach((dep) => {
      this.addDescriptor(dep);
    });
  }

  public bindService({ descriptor, service, instance: instance }: ServiceOpts) {
    const spec = parseService(descriptor, service, instance);
    this.addDescriptor(descriptor);
    this.discovery.services.push(`${spec.packge}.${spec.name}`);
    for (const method of spec.methods) {
      const url = `/invoke/${spec.packge}.${spec.name}/${method.name}`;
      this.methods[url] = new HostedGrpcServiceMethod(
        instance,
        service,
        method
      );
      // note that this log will not print all the keys.
      console.info(
        `Registering: ${url}  -> ${JSON.stringify(method, null, "\t")}`
      );
    }
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
}

export class RestateServer extends BaseRestateServer {
  constructor() {
    super(ProtocolMode.BIDI_STREAM);
  }

  public bindService({
    descriptor,
    service,
    instance: instance,
  }: ServiceOpts): RestateServer {
    super.bindService({
      descriptor,
      service,
      instance: instance,
    });
    return this;
  }

  public async listen(port: number) {
    console.info(`listening on ${port}...`);

    for await (const connection of incomingConnectionAtPort(
      port,
      this.discovery
    )) {
      const method = this.methodByUrl(connection.url.path);
      if (method === undefined) {
        console.info(`INFO no service found for URL ${connection.url.path}`);
        connection.respond404();
      } else {
        console.info(`INFO new stream for ${connection.url.path}`);
        connection.respondOk();
        new DurableExecutionStateMachine(
          connection,
          method,
          ProtocolMode.BIDI_STREAM
        );
      }
    }
  }
}
