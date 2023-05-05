"use strict";

import { RestateContext, setContext } from "../restate_context";
import { FileDescriptorProto } from "ts-proto-descriptors";

export class GrpcServiceMethod<I, O> {
  constructor(
    readonly name: string, // the gRPC name as defined in the .proto file
    readonly localName: string, // the method name as defined in the class.
    readonly localFn: (instance: unknown, input: I) => Promise<O>, // the actual function
    readonly inputDecoder: (buf: Uint8Array) => I, // the protobuf decoder
    readonly outputEncoder: (output: O) => Uint8Array // protobuf encoder
  ) {}
}

export class GrpcService {
  constructor(
    readonly name: string,
    readonly packge: string,
    readonly impl: object,
    readonly methods: Array<GrpcServiceMethod<unknown, unknown>>
  ) {}
}


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

//
// The following definitions are equivalent to the ones
// generated by the protoc ts plugin.
// we use them to traverse the FileDescriptor
//

type ProtoMetaMessageOptions = {
  options?: { [key: string]: any };
  fields?: { [key: string]: { [key: string]: any } };
  oneof?: { [key: string]: { [key: string]: any } };
  nested?: { [key: string]: ProtoMetaMessageOptions };
};

export interface ProtoMetadata {
  fileDescriptor: FileDescriptorProto;
  references: { [key: string]: any };
  dependencies?: ProtoMetadata[];
  options?: {
    options?: { [key: string]: any };
    services?: {
      [key: string]: {
        options?: { [key: string]: any };
        methods?: { [key: string]: { [key: string]: any } };
      };
    };
    messages?: { [key: string]: ProtoMetaMessageOptions };
    enums?: {
      [key: string]: {
        options?: { [key: string]: any };
        values?: { [key: string]: { [key: string]: any } };
      };
    };
  };
}

