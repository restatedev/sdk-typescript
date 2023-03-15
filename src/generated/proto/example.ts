/* eslint-disable */
import _m0 from "protobufjs/minimal";
import { FileDescriptorProto as FileDescriptorProto1 } from "ts-proto-descriptors";
import { protoMetadata as protoMetadata1 } from "./ext";

export const protobufPackage = "dev.restate";

export interface GreetRequest {
  name: string;
}

export interface GreetResponse {
  greeting: string;
}

function createBaseGreetRequest(): GreetRequest {
  return { name: "" };
}

export const GreetRequest = {
  encode(message: GreetRequest, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.name !== "") {
      writer.uint32(10).string(message.name);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): GreetRequest {
    const reader = input instanceof _m0.Reader ? input : new _m0.Reader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseGreetRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.name = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },

  fromJSON(object: any): GreetRequest {
    return { name: isSet(object.name) ? String(object.name) : "" };
  },

  toJSON(message: GreetRequest): unknown {
    const obj: any = {};
    message.name !== undefined && (obj.name = message.name);
    return obj;
  },

  create(base?: DeepPartial<GreetRequest>): GreetRequest {
    return GreetRequest.fromPartial(base ?? {});
  },

  fromPartial(object: DeepPartial<GreetRequest>): GreetRequest {
    const message = createBaseGreetRequest();
    message.name = object.name ?? "";
    return message;
  },
};

function createBaseGreetResponse(): GreetResponse {
  return { greeting: "" };
}

export const GreetResponse = {
  encode(message: GreetResponse, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.greeting !== "") {
      writer.uint32(10).string(message.greeting);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): GreetResponse {
    const reader = input instanceof _m0.Reader ? input : new _m0.Reader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseGreetResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.greeting = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },

  fromJSON(object: any): GreetResponse {
    return { greeting: isSet(object.greeting) ? String(object.greeting) : "" };
  },

  toJSON(message: GreetResponse): unknown {
    const obj: any = {};
    message.greeting !== undefined && (obj.greeting = message.greeting);
    return obj;
  },

  create(base?: DeepPartial<GreetResponse>): GreetResponse {
    return GreetResponse.fromPartial(base ?? {});
  },

  fromPartial(object: DeepPartial<GreetResponse>): GreetResponse {
    const message = createBaseGreetResponse();
    message.greeting = object.greeting ?? "";
    return message;
  },
};

export interface Greeter {
  greet(request: GreetRequest): Promise<GreetResponse>;
  multiWord(request: GreetRequest): Promise<GreetResponse>;
}

export class GreeterClientImpl implements Greeter {
  private readonly rpc: Rpc;
  private readonly service: string;
  constructor(rpc: Rpc, opts?: { service?: string }) {
    this.service = opts?.service || "dev.restate.Greeter";
    this.rpc = rpc;
    this.greet = this.greet.bind(this);
    this.multiWord = this.multiWord.bind(this);
  }
  greet(request: GreetRequest): Promise<GreetResponse> {
    const data = GreetRequest.encode(request).finish();
    const promise = this.rpc.request(this.service, "Greet", data);
    return promise.then((data) => GreetResponse.decode(new _m0.Reader(data)));
  }

  multiWord(request: GreetRequest): Promise<GreetResponse> {
    const data = GreetRequest.encode(request).finish();
    const promise = this.rpc.request(this.service, "MultiWord", data);
    return promise.then((data) => GreetResponse.decode(new _m0.Reader(data)));
  }
}

interface Rpc {
  request(service: string, method: string, data: Uint8Array): Promise<Uint8Array>;
}

type ProtoMetaMessageOptions = {
  options?: { [key: string]: any };
  fields?: { [key: string]: { [key: string]: any } };
  oneof?: { [key: string]: { [key: string]: any } };
  nested?: { [key: string]: ProtoMetaMessageOptions };
};

export interface ProtoMetadata {
  fileDescriptor: FileDescriptorProto1;
  references: { [key: string]: any };
  dependencies?: ProtoMetadata[];
  options?: {
    options?: { [key: string]: any };
    services?: {
      [key: string]: { options?: { [key: string]: any }; methods?: { [key: string]: { [key: string]: any } } };
    };
    messages?: { [key: string]: ProtoMetaMessageOptions };
    enums?: { [key: string]: { options?: { [key: string]: any }; values?: { [key: string]: { [key: string]: any } } } };
  };
}

export const protoMetadata: ProtoMetadata = {
  fileDescriptor: FileDescriptorProto1.fromPartial({
    "name": "proto/example.proto",
    "package": "dev.restate",
    "dependency": ["proto/ext.proto"],
    "publicDependency": [],
    "weakDependency": [],
    "messageType": [{
      "name": "GreetRequest",
      "field": [{
        "name": "name",
        "number": 1,
        "label": 1,
        "type": 9,
        "typeName": "",
        "extendee": "",
        "defaultValue": "",
        "oneofIndex": 0,
        "jsonName": "name",
        "options": {
          "ctype": 0,
          "packed": false,
          "jstype": 0,
          "lazy": false,
          "deprecated": false,
          "weak": false,
          "uninterpretedOption": [],
        },
        "proto3Optional": false,
      }],
      "extension": [],
      "nestedType": [],
      "enumType": [],
      "extensionRange": [],
      "oneofDecl": [],
      "options": undefined,
      "reservedRange": [],
      "reservedName": [],
    }, {
      "name": "GreetResponse",
      "field": [{
        "name": "greeting",
        "number": 1,
        "label": 1,
        "type": 9,
        "typeName": "",
        "extendee": "",
        "defaultValue": "",
        "oneofIndex": 0,
        "jsonName": "greeting",
        "options": undefined,
        "proto3Optional": false,
      }],
      "extension": [],
      "nestedType": [],
      "enumType": [],
      "extensionRange": [],
      "oneofDecl": [],
      "options": undefined,
      "reservedRange": [],
      "reservedName": [],
    }],
    "enumType": [],
    "service": [{
      "name": "Greeter",
      "method": [{
        "name": "Greet",
        "inputType": ".dev.restate.GreetRequest",
        "outputType": ".dev.restate.GreetResponse",
        "options": { "deprecated": false, "idempotencyLevel": 0, "uninterpretedOption": [] },
        "clientStreaming": false,
        "serverStreaming": false,
      }, {
        "name": "MultiWord",
        "inputType": ".dev.restate.GreetRequest",
        "outputType": ".dev.restate.GreetResponse",
        "options": { "deprecated": false, "idempotencyLevel": 0, "uninterpretedOption": [] },
        "clientStreaming": false,
        "serverStreaming": false,
      }],
      "options": { "deprecated": false, "uninterpretedOption": [] },
    }],
    "extension": [],
    "options": {
      "javaPackage": "com.dev.restate",
      "javaOuterClassname": "ExampleProto",
      "javaMultipleFiles": true,
      "javaGenerateEqualsAndHash": false,
      "javaStringCheckUtf8": false,
      "optimizeFor": 1,
      "goPackage": "",
      "ccGenericServices": false,
      "javaGenericServices": false,
      "pyGenericServices": false,
      "phpGenericServices": false,
      "deprecated": false,
      "ccEnableArenas": false,
      "objcClassPrefix": "DRX",
      "csharpNamespace": "Dev.Restate",
      "swiftPrefix": "",
      "phpClassPrefix": "",
      "phpNamespace": "Dev\\Restate",
      "phpMetadataNamespace": "Dev\\Restate\\GPBMetadata",
      "rubyPackage": "Dev::Restate",
      "uninterpretedOption": [],
    },
    "sourceCodeInfo": { "location": [] },
    "syntax": "proto3",
  }),
  references: {
    ".dev.restate.GreetRequest": GreetRequest,
    ".dev.restate.GreetResponse": GreetResponse,
    ".dev.restate.Greeter": GreeterClientImpl,
  },
  dependencies: [protoMetadata1],
  options: {
    messages: { "GreetRequest": { fields: { "name": { "field": 0 } } } },
    services: { "Greeter": { options: { "service_type": 1 }, methods: {} } },
  },
};

type Builtin = Date | Function | Uint8Array | string | number | boolean | undefined;

export type DeepPartial<T> = T extends Builtin ? T
  : T extends Array<infer U> ? Array<DeepPartial<U>> : T extends ReadonlyArray<infer U> ? ReadonlyArray<DeepPartial<U>>
  : T extends {} ? { [K in keyof T]?: DeepPartial<T[K]> }
  : Partial<T>;

function isSet(value: any): boolean {
  return value !== null && value !== undefined;
}
