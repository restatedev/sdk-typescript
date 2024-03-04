/*
 * Copyright (c) 2023-2024 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

/* eslint-disable @typescript-eslint/ban-types */

import {
  GrpcService,
  GrpcServiceMethod,
  HostedGrpcServiceMethod,
  ProtoMetadata,
} from "../types/grpc";
import {
  DeepPartial,
  ServiceDiscoveryResponse,
} from "../generated/proto/discovery";
import { Event } from "../types/types";
import {
  FileDescriptorProto,
  UninterpretedOption,
} from "../generated/google/protobuf/descriptor";
import { Empty } from "../generated/google/protobuf/empty";
import {
  FileDescriptorProto as FileDescriptorProto1,
  ServiceDescriptorProto as ServiceDescriptorProto1,
  MethodDescriptorProto as MethodDescriptorProto1,
} from "ts-proto-descriptors";
import {
  fieldTypeToJSON,
  ServiceType,
  serviceTypeToJSON,
} from "../generated/dev/restate/ext";
import {
  RpcRequest,
  RpcResponse,
  ProtoMetadata as RpcServiceProtoMetadata,
  protoMetadata as rpcServiceProtoMetadata,
  KeyedEvent,
} from "../generated/proto/dynrpc";
import { Context, KeyedContext, useContext, useKeyedContext } from "../context";
import { verifyAssumptions } from "../utils/assumptions";
import { RestateEndpoint, ServiceBundle, TerminalError } from "../public_api";
import { KeyedRouter, UnKeyedRouter, isEventHandler } from "../types/router";
import { jsonSafeAny } from "../utils/utils";
import { rlog } from "../logger";
import { ServiceOpts } from "../endpoint";
import http2, { Http2ServerRequest, Http2ServerResponse } from "http2";
import { Http2Handler } from "./http2_handler";
import { LambdaHandler } from "./lambda_handler";

export class EndpointImpl implements RestateEndpoint {
  protected readonly methods: Record<
    string,
    HostedGrpcServiceMethod<unknown, unknown>
  > = {};
  readonly discovery: DeepPartial<ServiceDiscoveryResponse>;
  protected readonly dynrpcDescriptor: RpcServiceProtoMetadata;

  public constructor() {
    this.discovery = {
      files: { file: [] },
      services: [],
      minProtocolVersion: 0,
      maxProtocolVersion: 0,
    };
    this.dynrpcDescriptor = copyProtoMetadata(rpcServiceProtoMetadata);
  }

  bindService({ descriptor, service, instance }: ServiceOpts): RestateEndpoint {
    const spec = parseService(descriptor, service, instance);
    this.addDescriptor(descriptor);

    const qname =
      spec.packge === "" ? spec.name : `${spec.packge}.${spec.name}`;

    this.discovery.services?.push(qname);
    for (const method of spec.methods) {
      const url = `/invoke/${qname}/${method.name}`;
      this.methods[url] = new HostedGrpcServiceMethod(
        instance,
        spec.packge,
        service,
        method
      );
      // note that this log will not print all the keys.
      rlog.info(`Binding: ${url}  -> ${JSON.stringify(method, null, "\t")}`);
    }

    return this;
  }

  public bindRouter<M>(
    path: string,
    router: UnKeyedRouter<M>
  ): RestateEndpoint {
    this.bindRpcService(path, router, false);
    return this;
  }

  public bindKeyedRouter<M>(
    path: string,
    router: KeyedRouter<M>
  ): RestateEndpoint {
    this.bindRpcService(path, router, true);
    return this;
  }

  public bind(services: ServiceBundle): RestateEndpoint {
    services.registerServices(this);
    return this;
  }

  http2Handler(): (
    request: Http2ServerRequest,
    response: Http2ServerResponse
  ) => void {
    const handler = new Http2Handler(this);
    return handler.acceptConnection.bind(handler);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lambdaHandler(): (event: any, ctx: any) => Promise<any> {
    const handler = new LambdaHandler(this);
    return handler.handleRequest.bind(handler);
  }

  listen(port?: number): Promise<void> {
    const actualPort = port ?? parseInt(process.env.PORT ?? "9080");
    rlog.info(`Listening on ${actualPort}...`);

    const server = http2.createServer(this.http2Handler());
    server.listen(actualPort);
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    return new Promise(() => {});
  }

  // Private methods to build the endpoint

  private addDescriptor(descriptor: ProtoMetadata) {
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
      this.discovery.files?.file?.filter(
        (haveDesc) => desc.name === haveDesc.name
      ).length === 0
    ) {
      this.discovery.files?.file.push(desc);
    }
    descriptor.dependencies?.forEach((dep) => {
      this.addDescriptor(dep);
    });
  }

  private rpcHandler(
    keyed: boolean,
    route: string,
    handler: Function
  ): {
    descriptor: MethodDescriptorProto1;
    method: GrpcServiceMethod<unknown, unknown>;
  } {
    const descriptor = createRpcMethodDescriptor(route);

    const localMethod = (instance: unknown, input: RpcRequest) => {
      if (keyed) {
        return dispatchKeyedRpcHandler(
          useKeyedContext(instance),
          input,
          handler
        );
      } else {
        return dispatchUnkeyedRpcHandler(useContext(instance), input, handler);
      }
    };

    const decoder = RpcRequest.decode;
    const encoder = (message: RpcResponse) =>
      RpcResponse.encode({
        response: jsonSafeAny("", message.response),
      }).finish();

    const method = new GrpcServiceMethod<RpcRequest, RpcResponse>(
      route,
      route,
      keyed,
      localMethod,
      decoder,
      encoder
    );

    return {
      descriptor: descriptor,
      method: method as GrpcServiceMethod<unknown, unknown>,
    };
  }

  stringKeyedEventHandler(
    keyed: boolean,
    route: string,
    handler: Function
  ): {
    descriptor: MethodDescriptorProto1;
    method: GrpcServiceMethod<unknown, unknown>;
  } {
    if (!keyed) {
      // TODO: support unkeyed rpc event handler
      throw new TerminalError("Unkeyed Event handlers are not yet supported.");
    }
    const descriptor = createStringKeyedMethodDescriptor(route);
    const localMethod = (instance: unknown, input: KeyedEvent) => {
      return dispatchKeyedEventHandler(
        useKeyedContext(instance),
        input,
        handler
      );
    };

    const decoder = KeyedEvent.decode;
    const encoder = (message: Empty) => Empty.encode(message).finish();

    const method = new GrpcServiceMethod<KeyedEvent, Empty>(
      route,
      route,
      keyed,
      localMethod,
      decoder,
      encoder
    );

    return {
      descriptor,
      method: method as GrpcServiceMethod<unknown, unknown>,
    };
  }

  private bindRpcService(name: string, router: RpcRouter, keyed: boolean) {
    if (name === undefined || router === undefined || keyed === undefined) {
      throw new Error("incomplete arguments: (name, router, keyed)");
    }
    if (!(typeof name === "string") || name.length === 0) {
      throw new Error("service name must be a non-empty string");
    }
    if (name.indexOf("/") !== -1) {
      throw new Error("service name must not contain any slash '/'");
    }

    const lastDot = name.indexOf(".");
    const serviceName = lastDot === -1 ? name : name.substring(lastDot + 1);
    const servicePackage = name.substring(
      0,
      name.length - serviceName.length - 1
    );

    const desc = this.dynrpcDescriptor;
    const serviceGrpcSpec = keyed
      ? pushKeyedService(desc, name)
      : pushUnKeyedService(desc, name);

    for (const [route, handler] of Object.entries(router)) {
      let registration: {
        descriptor: MethodDescriptorProto1;
        method: GrpcServiceMethod<unknown, unknown>;
      };

      if (isEventHandler(handler)) {
        const theHandler = handler.handler;
        registration = this.stringKeyedEventHandler(keyed, route, theHandler);
      } else {
        registration = this.rpcHandler(keyed, route, handler);
      }
      serviceGrpcSpec.method.push(registration.descriptor);
      const url = `/invoke/${name}/${route}`;
      this.methods[url] = new HostedGrpcServiceMethod(
        {}, // we don't actually execute on any class instance
        servicePackage,
        serviceName,
        registration.method
      ) as HostedGrpcServiceMethod<unknown, unknown>;

      rlog.info(
        `Binding: ${url}  -> ${JSON.stringify(registration.method, null, "\t")}`
      );
    }

    // since we modified this descriptor, we need to remove it in case it was added before,
    // so that the modified version is processed and added again
    const filteredFiles = this.discovery.files?.file?.filter(
      (haveDesc) => desc.fileDescriptor.name !== haveDesc.name
    );
    if (this.discovery.files !== undefined && filteredFiles !== undefined) {
      this.discovery.files.file = filteredFiles;
    }

    this.addDescriptor(desc);
    this.discovery.services?.push(name);
  }

  methodByUrl<I, O>(
    url: string | undefined | null
  ): HostedGrpcServiceMethod<I, O> | undefined {
    if (url == undefined || url === null) {
      return undefined;
    }
    return this.methods[url] as HostedGrpcServiceMethod<I, O>;
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function indexProperties(instance: any): Map<string, string> {
  const names = new Map<string, string>();
  while (
    instance !== null &&
    instance !== undefined &&
    instance !== Object.prototype
  ) {
    for (const property of Object.getOwnPropertyNames(instance)) {
      names.set(property.toLowerCase(), property);
    }
    instance = Object.getPrototypeOf(instance);
  }
  return names;
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

  const service_type =
    meta.options?.services?.[serviceName].options?.["service_type"];
  const keyed = service_type !== ServiceType.UNKEYED;

  // index all the existing properties that `instance` has.
  // we index them by the lower case represention.
  const names = indexProperties(instance);
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
          keyed,
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

export type RpcRouter = {
  [key: string]: Function;
};

async function dispatchKeyedRpcHandler(
  ctx: KeyedContext,
  req: RpcRequest,
  handler: Function
): Promise<RpcResponse> {
  const { key, request } = verifyAssumptions(true, req);
  if (typeof key !== "string" || key.length === 0) {
    // we throw a terminal error here, because this cannot be patched by updating code:
    // if the request is wrong (missing a key), the request can never make it
    throw new TerminalError(
      "Keyed handlers must recieve a non null or empty string key"
    );
  }
  const jsResult = (await handler(ctx, key, request)) as any;
  return RpcResponse.create({ response: jsResult });
}

async function dispatchUnkeyedRpcHandler(
  ctx: Context,
  req: RpcRequest,
  handler: Function
): Promise<RpcResponse> {
  const { request } = verifyAssumptions(false, req);
  const result = await handler(ctx, request);
  return RpcResponse.create({ response: result });
}

async function dispatchKeyedEventHandler(
  ctx: KeyedContext,
  req: KeyedEvent,
  handler: Function
): Promise<Empty> {
  const key = req.key;
  if (key === null || key === undefined || key.length === 0) {
    // we throw a terminal error here, because this cannot be patched by updating code:
    // if the request is wrong (missing a key), the request can never make it
    throw new TerminalError(
      "Keyed handlers must receive a non null or empty string key"
    );
  }
  const jsEvent = new Event(key, req.payload, req.attributes);
  await handler(ctx, jsEvent);
  return Empty.create({});
}

function copyProtoMetadata(
  original: RpcServiceProtoMetadata
): RpcServiceProtoMetadata {
  // duplicate the file descriptor. shallow, because we only need to
  // change one top-level field: service[]
  const fileDescriptorCopy = {
    ...original.fileDescriptor,
  } as FileDescriptorProto1;
  fileDescriptorCopy.service = [];

  let options = original.options;
  if (options !== undefined) {
    options = {
      ...original.options,
    };
    options.services = {};
  }

  return {
    fileDescriptor: fileDescriptorCopy,
    references: original.references,
    dependencies: original.dependencies,
    options: options,
  };
}

function pushKeyedService(
  desc: RpcServiceProtoMetadata,
  newName: string
): ServiceDescriptorProto1 {
  const service = {
    ...rpcServiceProtoMetadata.fileDescriptor.service[0],
  } as ServiceDescriptorProto1;
  service.name = newName;
  service.method = [];
  desc.fileDescriptor.service.push(service);

  const serviceOptions =
    rpcServiceProtoMetadata.options?.services?.["RpcEndpoint"];
  if (serviceOptions === undefined) {
    throw new Error(
      "Missing service options in original RpcEndpoint proto descriptor"
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  desc.options!.services![newName] = serviceOptions;

  return service;
}

function pushUnKeyedService(
  desc: RpcServiceProtoMetadata,
  newName: string
): ServiceDescriptorProto1 {
  const service = {
    ...rpcServiceProtoMetadata.fileDescriptor.service[1],
  } as ServiceDescriptorProto1;
  service.name = newName;
  service.method = [];
  desc.fileDescriptor.service.push(service);

  const serviceOptions =
    rpcServiceProtoMetadata.options?.services?.["UnkeyedRpcEndpoint"];
  if (serviceOptions === undefined) {
    throw new Error(
      "Missing service options in original UnkeyedRpcEndpoint proto descriptor"
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  desc.options!.services![newName] = serviceOptions;

  return service;
}

function createRpcMethodDescriptor(methodName: string): MethodDescriptorProto1 {
  const desc = {
    ...rpcServiceProtoMetadata.fileDescriptor.service[0].method[0],
  } as MethodDescriptorProto1;
  desc.name = methodName;
  return desc;
}

function createStringKeyedMethodDescriptor(
  methodName: string
): MethodDescriptorProto1 {
  const desc = {
    ...rpcServiceProtoMetadata.fileDescriptor.service[0].method[1],
  } as MethodDescriptorProto1;
  desc.name = methodName;
  return desc;
}
