"use strict";

import { rlog } from "../utils/logger";
import {
  GrpcService,
  GrpcServiceMethod,
  HostedGrpcServiceMethod,
  ProtoMetadata,
} from "../types/grpc";
import {
  ProtocolMode,
  ServiceDiscoveryResponse,
} from "../generated/proto/discovery";
import {
  FileDescriptorProto,
  UninterpretedOption,
} from "../generated/google/protobuf/descriptor";
import {
  fieldTypeToJSON,
  serviceTypeToJSON,
} from "../generated/dev/restate/ext";

export interface ServiceOpts {
  descriptor: ProtoMetadata;
  service: string;
  instance: unknown;
}

export abstract class BaseRestateServer {
  protected readonly methods: Record<
    string,
    HostedGrpcServiceMethod<unknown, unknown>
  > = {};
  protected readonly discovery: ServiceDiscoveryResponse;

  protected constructor(protocolMode: ProtocolMode) {
    this.discovery = {
      files: { file: [] },
      services: [],
      minProtocolVersion: 0,
      maxProtocolVersion: 0,
      protocolMode: protocolMode,
    };
  }

  protected addDescriptor(descriptor: ProtoMetadata) {
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

  protected bindService({ descriptor, service, instance }: ServiceOpts) {
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
      rlog.info(
        `Registering: ${url}  -> ${JSON.stringify(method, null, "\t")}`
      );
    }
  }

  protected methodByUrl<I, O>(
    url: string | undefined | null
  ): HostedGrpcServiceMethod<I, O> | undefined {
    if (url == undefined || url === null) {
      return undefined;
    }
    const method = this.methods[url];
    if (method === null || method === undefined) {
      return undefined;
    }
    // create new instance each time as reject and resolve must not be shared across invocations
    return new HostedGrpcServiceMethod<I, O>(method.instance, method.service, method.method as GrpcServiceMethod<I, O>)
  }
}

// Given:
// * an instance of a class that implements a gRPC TypeScript interface,
//   as generated by our protoc plugin, this method
// * The ProtobufFileDescriptor as generated by the protobuf plugin
// * and the gRPC service name
//
// Return a GrpcService definition, as defined above.
//
// For example (see first: example.proto and example.ts):
//
// > parse(example.protoMetaData, "Greeter", new GreeterService())
//
//  produces ~
//
//  serviceName: 'Greeter',
//  instance: GreeterService {},
//  methods: {
//    multiword: {
//     localName: 'multiWord',
//     fn: [Function: multiWord],
//     inputType: [Object],
//     outputType: [Object]
//    },
//    greet: {
//      localName: 'greet',
//      fn: [Function: greet],
//      inputType: [Object],
//      outputType: [Object]
//    }
//  }
//}
//
/* eslint-disable @typescript-eslint/no-explicit-any */
export function parseService(
  meta: ProtoMetadata,
  serviceName: string,
  instance: any
) {
  const svcMethods: Array<GrpcServiceMethod<unknown, unknown>> = [];

  // index all the existing properties that `instance` has.
  // we index them by the lower case represention.
  const prototype = Object.getPrototypeOf(instance);
  const names = new Map<string, string>(
    Object.getOwnPropertyNames(prototype).map((name) => [
      name.toLowerCase(),
      name,
    ])
  );

  for (const serviceDescriptor of meta.fileDescriptor.service) {
    if (serviceName !== serviceDescriptor.name) {
      continue;
    }
    for (const methodDescriptor of serviceDescriptor.method) {
      const lowercaseName = methodDescriptor.name.toLowerCase();
      const localName = names.get(lowercaseName);
      if (localName === undefined || localName === null) {
        throw new Error(`unimplemented method ${methodDescriptor.name}`);
      }
      const fn = instance[localName];
      if (typeof fn !== "function") {
        throw new Error(
          `A property ${localName} exists, which coresponds to a gRPC service named ${methodDescriptor.name}, but that property is not a function.`
        );
      }
      const localMethod = async (instance: unknown, input: unknown) => {
        return await fn.call(instance, input);
      };
      let inputMessage = meta.references[methodDescriptor.inputType];
      // If the input message type is not defined by the proto files of the service but by a dependency (e.g. BoolValue, Empty, etc)
      // then we need to look for the encoders and decoders in the dependencies.
      if (inputMessage === undefined) {
        meta.dependencies?.forEach((dep) => {
          if (dep.references[methodDescriptor.inputType] !== undefined) {
            inputMessage = dep.references[methodDescriptor.inputType];
          }
        });
      }
      let outputMessage = meta.references[methodDescriptor.outputType];
      // If the output message type is not defined by use but by the proto files of the service (e.g. BoolValue, Empty, etc)
      // then we need to look for the encoders and decoders in the dependencies.
      if (outputMessage === undefined) {
        meta.dependencies?.forEach((dep) => {
          if (dep.references[methodDescriptor.outputType] !== undefined) {
            outputMessage = dep.references[methodDescriptor.outputType];
          }
        });
      }

      const decoder = (buffer: Uint8Array) => inputMessage.decode(buffer);
      const encoder = (message: unknown) =>
        outputMessage.encode(message).finish();
      svcMethods.push(
        new GrpcServiceMethod<unknown, unknown>(
          methodDescriptor.name,
          localName,
          localMethod,
          decoder,
          encoder
        )
      );
    }
    return new GrpcService(
      serviceName,
      meta.fileDescriptor.package,
      instance,
      svcMethods
    );
  }
  throw new Error(`Unable to find a service ${serviceName}.`);
}
