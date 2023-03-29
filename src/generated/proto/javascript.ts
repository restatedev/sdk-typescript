/* eslint-disable */
import _m0 from "protobufjs/minimal";
import { FileDescriptorProto as FileDescriptorProto1 } from "ts-proto-descriptors";
import { Failure, protoMetadata as protoMetadata1 } from "./protocol";

export const protobufPackage = "dev.restate.sdk.javascript";

/**
 * Type: 0xFC00 + 1
 * Flag: RequiresRuntimeAck
 */
export interface SideEffectEntryMessage {
  value?: Buffer | undefined;
  failure?: Failure | undefined;
}

function createBaseSideEffectEntryMessage(): SideEffectEntryMessage {
  return { value: undefined, failure: undefined };
}

export const SideEffectEntryMessage = {
  encode(message: SideEffectEntryMessage, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.value !== undefined) {
      writer.uint32(114).bytes(message.value);
    }
    if (message.failure !== undefined) {
      Failure.encode(message.failure, writer.uint32(122).fork()).ldelim();
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SideEffectEntryMessage {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSideEffectEntryMessage();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 14:
          if (tag != 114) {
            break;
          }

          message.value = reader.bytes() as Buffer;
          continue;
        case 15:
          if (tag != 122) {
            break;
          }

          message.failure = Failure.decode(reader, reader.uint32());
          continue;
      }
      if ((tag & 7) == 4 || tag == 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  fromJSON(object: any): SideEffectEntryMessage {
    return {
      value: isSet(object.value) ? Buffer.from(bytesFromBase64(object.value)) : undefined,
      failure: isSet(object.failure) ? Failure.fromJSON(object.failure) : undefined,
    };
  },

  toJSON(message: SideEffectEntryMessage): unknown {
    const obj: any = {};
    message.value !== undefined &&
      (obj.value = message.value !== undefined ? base64FromBytes(message.value) : undefined);
    message.failure !== undefined && (obj.failure = message.failure ? Failure.toJSON(message.failure) : undefined);
    return obj;
  },

  create(base?: DeepPartial<SideEffectEntryMessage>): SideEffectEntryMessage {
    return SideEffectEntryMessage.fromPartial(base ?? {});
  },

  fromPartial(object: DeepPartial<SideEffectEntryMessage>): SideEffectEntryMessage {
    const message = createBaseSideEffectEntryMessage();
    message.value = object.value ?? undefined;
    message.failure = (object.failure !== undefined && object.failure !== null)
      ? Failure.fromPartial(object.failure)
      : undefined;
    return message;
  },
};

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
    "name": "proto/javascript.proto",
    "package": "dev.restate.sdk.javascript",
    "dependency": ["proto/protocol.proto"],
    "publicDependency": [],
    "weakDependency": [],
    "messageType": [{
      "name": "SideEffectEntryMessage",
      "field": [{
        "name": "value",
        "number": 14,
        "label": 1,
        "type": 12,
        "typeName": "",
        "extendee": "",
        "defaultValue": "",
        "oneofIndex": 0,
        "jsonName": "value",
        "options": undefined,
        "proto3Optional": false,
      }, {
        "name": "failure",
        "number": 15,
        "label": 1,
        "type": 11,
        "typeName": ".dev.restate.service.protocol.Failure",
        "extendee": "",
        "defaultValue": "",
        "oneofIndex": 0,
        "jsonName": "failure",
        "options": undefined,
        "proto3Optional": false,
      }],
      "extension": [],
      "nestedType": [],
      "enumType": [],
      "extensionRange": [],
      "oneofDecl": [{ "name": "result", "options": undefined }],
      "options": undefined,
      "reservedRange": [],
      "reservedName": [],
    }],
    "enumType": [],
    "service": [],
    "extension": [],
    "options": {
      "javaPackage": "com.dev.restate.sdk.javascript",
      "javaOuterClassname": "JavascriptProto",
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
      "objcClassPrefix": "DRSJ",
      "csharpNamespace": "Dev.Restate.Sdk.Javascript",
      "swiftPrefix": "",
      "phpClassPrefix": "",
      "phpNamespace": "Dev\\Restate\\Sdk\\Javascript",
      "phpMetadataNamespace": "Dev\\Restate\\Sdk\\Javascript\\GPBMetadata",
      "rubyPackage": "Dev::Restate::Sdk::Javascript",
      "uninterpretedOption": [],
    },
    "sourceCodeInfo": {
      "location": [{
        "path": [4, 0],
        "span": [8, 0, 13, 1],
        "leadingComments": " Type: 0xFC00 + 1\n Flag: RequiresRuntimeAck\n",
        "trailingComments": "",
        "leadingDetachedComments": [],
      }],
    },
    "syntax": "proto3",
  }),
  references: { ".dev.restate.sdk.javascript.SideEffectEntryMessage": SideEffectEntryMessage },
  dependencies: [protoMetadata1],
};

declare var self: any | undefined;
declare var window: any | undefined;
declare var global: any | undefined;
var tsProtoGlobalThis: any = (() => {
  if (typeof globalThis !== "undefined") {
    return globalThis;
  }
  if (typeof self !== "undefined") {
    return self;
  }
  if (typeof window !== "undefined") {
    return window;
  }
  if (typeof global !== "undefined") {
    return global;
  }
  throw "Unable to locate global object";
})();

function bytesFromBase64(b64: string): Uint8Array {
  if (tsProtoGlobalThis.Buffer) {
    return Uint8Array.from(tsProtoGlobalThis.Buffer.from(b64, "base64"));
  } else {
    const bin = tsProtoGlobalThis.atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; ++i) {
      arr[i] = bin.charCodeAt(i);
    }
    return arr;
  }
}

function base64FromBytes(arr: Uint8Array): string {
  if (tsProtoGlobalThis.Buffer) {
    return tsProtoGlobalThis.Buffer.from(arr).toString("base64");
  } else {
    const bin: string[] = [];
    arr.forEach((byte) => {
      bin.push(String.fromCharCode(byte));
    });
    return tsProtoGlobalThis.btoa(bin.join(""));
  }
}

type Builtin = Date | Function | Uint8Array | string | number | boolean | undefined;

export type DeepPartial<T> = T extends Builtin ? T
  : T extends Array<infer U> ? Array<DeepPartial<U>> : T extends ReadonlyArray<infer U> ? ReadonlyArray<DeepPartial<U>>
  : T extends {} ? { [K in keyof T]?: DeepPartial<T[K]> }
  : Partial<T>;

function isSet(value: any): boolean {
  return value !== null && value !== undefined;
}
