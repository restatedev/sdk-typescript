/* eslint-disable */
import _m0 from "protobufjs/minimal";
import { FileDescriptorProto as FileDescriptorProto1 } from "ts-proto-descriptors";
import { protoMetadata as protoMetadata1 } from "./ext";

export const protobufPackage = "dev.restate";

export interface TestRequest {
  name: string;
}

export interface TestResponse {
  greeting: string;
}

function createBaseTestRequest(): TestRequest {
  return { name: "" };
}

export const TestRequest = {
  encode(message: TestRequest, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.name !== "") {
      writer.uint32(10).string(message.name);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): TestRequest {
    const reader = input instanceof _m0.Reader ? input : new _m0.Reader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseTestRequest();
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

  fromJSON(object: any): TestRequest {
    return { name: isSet(object.name) ? String(object.name) : "" };
  },

  toJSON(message: TestRequest): unknown {
    const obj: any = {};
    message.name !== undefined && (obj.name = message.name);
    return obj;
  },

  create(base?: DeepPartial<TestRequest>): TestRequest {
    return TestRequest.fromPartial(base ?? {});
  },

  fromPartial(object: DeepPartial<TestRequest>): TestRequest {
    const message = createBaseTestRequest();
    message.name = object.name ?? "";
    return message;
  },
};

function createBaseTestResponse(): TestResponse {
  return { greeting: "" };
}

export const TestResponse = {
  encode(message: TestResponse, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.greeting !== "") {
      writer.uint32(10).string(message.greeting);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): TestResponse {
    const reader = input instanceof _m0.Reader ? input : new _m0.Reader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseTestResponse();
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

  fromJSON(object: any): TestResponse {
    return { greeting: isSet(object.greeting) ? String(object.greeting) : "" };
  },

  toJSON(message: TestResponse): unknown {
    const obj: any = {};
    message.greeting !== undefined && (obj.greeting = message.greeting);
    return obj;
  },

  create(base?: DeepPartial<TestResponse>): TestResponse {
    return TestResponse.fromPartial(base ?? {});
  },

  fromPartial(object: DeepPartial<TestResponse>): TestResponse {
    const message = createBaseTestResponse();
    message.greeting = object.greeting ?? "";
    return message;
  },
};

export interface TestGreeter {
  greet(request: TestRequest): Promise<TestResponse>;
}

export class TestGreeterClientImpl implements TestGreeter {
  private readonly rpc: Rpc;
  private readonly service: string;
  constructor(rpc: Rpc, opts?: { service?: string }) {
    this.service = opts?.service || "dev.restate.TestGreeter";
    this.rpc = rpc;
    this.greet = this.greet.bind(this);
  }
  greet(request: TestRequest): Promise<TestResponse> {
    const data = TestRequest.encode(request).finish();
    const promise = this.rpc.request(this.service, "Greet", data);
    return promise.then((data) => TestResponse.decode(new _m0.Reader(data)));
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
    "name": "proto/test.proto",
    "package": "dev.restate",
    "dependency": ["proto/ext.proto"],
    "publicDependency": [],
    "weakDependency": [],
    "messageType": [{
      "name": "TestRequest",
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
      "name": "TestResponse",
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
      "name": "TestGreeter",
      "method": [{
        "name": "Greet",
        "inputType": ".dev.restate.TestRequest",
        "outputType": ".dev.restate.TestResponse",
        "options": { "deprecated": false, "idempotencyLevel": 0, "uninterpretedOption": [] },
        "clientStreaming": false,
        "serverStreaming": false,
      }],
      "options": { "deprecated": false, "uninterpretedOption": [] },
    }],
    "extension": [],
    "options": undefined,
    "sourceCodeInfo": { "location": [] },
    "syntax": "proto3",
  }),
  references: {
    ".dev.restate.TestRequest": TestRequest,
    ".dev.restate.TestResponse": TestResponse,
    ".dev.restate.TestGreeter": TestGreeterClientImpl,
  },
  dependencies: [protoMetadata1],
  options: {
    messages: { "TestRequest": { fields: { "name": { "field": 0 } } } },
    services: { "TestGreeter": { options: { "service_type": 1 }, methods: {} } },
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
