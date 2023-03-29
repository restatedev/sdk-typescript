/* eslint-disable */
import _m0 from "protobufjs/minimal";
import { FileDescriptorProto as FileDescriptorProto1 } from "ts-proto-descriptors";
import { FileDescriptorSet, protoMetadata as protoMetadata1 } from "../google/protobuf/descriptor";

export const protobufPackage = "dev.restate.service.discovery";

export enum ProtocolMode {
  /** BIDI_STREAM - protolint:disable:next ENUM_FIELD_NAMES_ZERO_VALUE_END_WITH */
  BIDI_STREAM = 0,
  REQUEST_RESPONSE = 1,
  UNRECOGNIZED = -1,
}

export function protocolModeFromJSON(object: any): ProtocolMode {
  switch (object) {
    case 0:
    case "BIDI_STREAM":
      return ProtocolMode.BIDI_STREAM;
    case 1:
    case "REQUEST_RESPONSE":
      return ProtocolMode.REQUEST_RESPONSE;
    case -1:
    case "UNRECOGNIZED":
    default:
      return ProtocolMode.UNRECOGNIZED;
  }
}

export function protocolModeToJSON(object: ProtocolMode): string {
  switch (object) {
    case ProtocolMode.BIDI_STREAM:
      return "BIDI_STREAM";
    case ProtocolMode.REQUEST_RESPONSE:
      return "REQUEST_RESPONSE";
    case ProtocolMode.UNRECOGNIZED:
    default:
      return "UNRECOGNIZED";
  }
}

export interface ServiceDiscoveryRequest {
}

export interface ServiceDiscoveryResponse {
  /** List of all proto files used to define the services, including the dependencies. */
  files:
    | FileDescriptorSet
    | undefined;
  /** List of services to register. This might be a subset of services defined in files. */
  services: string[];
  /** Service-protocol version negotiation */
  minProtocolVersion: number;
  maxProtocolVersion: number;
  /** Protocol mode negotiation */
  protocolMode: ProtocolMode;
}

function createBaseServiceDiscoveryRequest(): ServiceDiscoveryRequest {
  return {};
}

export const ServiceDiscoveryRequest = {
  encode(_: ServiceDiscoveryRequest, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): ServiceDiscoveryRequest {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseServiceDiscoveryRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
      }
      if ((tag & 7) == 4 || tag == 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  fromJSON(_: any): ServiceDiscoveryRequest {
    return {};
  },

  toJSON(_: ServiceDiscoveryRequest): unknown {
    const obj: any = {};
    return obj;
  },

  create(base?: DeepPartial<ServiceDiscoveryRequest>): ServiceDiscoveryRequest {
    return ServiceDiscoveryRequest.fromPartial(base ?? {});
  },

  fromPartial(_: DeepPartial<ServiceDiscoveryRequest>): ServiceDiscoveryRequest {
    const message = createBaseServiceDiscoveryRequest();
    return message;
  },
};

function createBaseServiceDiscoveryResponse(): ServiceDiscoveryResponse {
  return { files: undefined, services: [], minProtocolVersion: 0, maxProtocolVersion: 0, protocolMode: 0 };
}

export const ServiceDiscoveryResponse = {
  encode(message: ServiceDiscoveryResponse, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.files !== undefined) {
      FileDescriptorSet.encode(message.files, writer.uint32(10).fork()).ldelim();
    }
    for (const v of message.services) {
      writer.uint32(18).string(v!);
    }
    if (message.minProtocolVersion !== 0) {
      writer.uint32(24).uint32(message.minProtocolVersion);
    }
    if (message.maxProtocolVersion !== 0) {
      writer.uint32(32).uint32(message.maxProtocolVersion);
    }
    if (message.protocolMode !== 0) {
      writer.uint32(40).int32(message.protocolMode);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): ServiceDiscoveryResponse {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseServiceDiscoveryResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag != 10) {
            break;
          }

          message.files = FileDescriptorSet.decode(reader, reader.uint32());
          continue;
        case 2:
          if (tag != 18) {
            break;
          }

          message.services.push(reader.string());
          continue;
        case 3:
          if (tag != 24) {
            break;
          }

          message.minProtocolVersion = reader.uint32();
          continue;
        case 4:
          if (tag != 32) {
            break;
          }

          message.maxProtocolVersion = reader.uint32();
          continue;
        case 5:
          if (tag != 40) {
            break;
          }

          message.protocolMode = reader.int32() as any;
          continue;
      }
      if ((tag & 7) == 4 || tag == 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  fromJSON(object: any): ServiceDiscoveryResponse {
    return {
      files: isSet(object.files) ? FileDescriptorSet.fromJSON(object.files) : undefined,
      services: Array.isArray(object?.services) ? object.services.map((e: any) => String(e)) : [],
      minProtocolVersion: isSet(object.minProtocolVersion) ? Number(object.minProtocolVersion) : 0,
      maxProtocolVersion: isSet(object.maxProtocolVersion) ? Number(object.maxProtocolVersion) : 0,
      protocolMode: isSet(object.protocolMode) ? protocolModeFromJSON(object.protocolMode) : 0,
    };
  },

  toJSON(message: ServiceDiscoveryResponse): unknown {
    const obj: any = {};
    message.files !== undefined && (obj.files = message.files ? FileDescriptorSet.toJSON(message.files) : undefined);
    if (message.services) {
      obj.services = message.services.map((e) => e);
    } else {
      obj.services = [];
    }
    message.minProtocolVersion !== undefined && (obj.minProtocolVersion = Math.round(message.minProtocolVersion));
    message.maxProtocolVersion !== undefined && (obj.maxProtocolVersion = Math.round(message.maxProtocolVersion));
    message.protocolMode !== undefined && (obj.protocolMode = protocolModeToJSON(message.protocolMode));
    return obj;
  },

  create(base?: DeepPartial<ServiceDiscoveryResponse>): ServiceDiscoveryResponse {
    return ServiceDiscoveryResponse.fromPartial(base ?? {});
  },

  fromPartial(object: DeepPartial<ServiceDiscoveryResponse>): ServiceDiscoveryResponse {
    const message = createBaseServiceDiscoveryResponse();
    message.files = (object.files !== undefined && object.files !== null)
      ? FileDescriptorSet.fromPartial(object.files)
      : undefined;
    message.services = object.services?.map((e) => e) || [];
    message.minProtocolVersion = object.minProtocolVersion ?? 0;
    message.maxProtocolVersion = object.maxProtocolVersion ?? 0;
    message.protocolMode = object.protocolMode ?? 0;
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
    "name": "proto/discovery.proto",
    "package": "dev.restate.service.discovery",
    "dependency": ["google/protobuf/descriptor.proto"],
    "publicDependency": [],
    "weakDependency": [],
    "messageType": [{
      "name": "ServiceDiscoveryRequest",
      "field": [],
      "extension": [],
      "nestedType": [],
      "enumType": [],
      "extensionRange": [],
      "oneofDecl": [],
      "options": undefined,
      "reservedRange": [],
      "reservedName": [],
    }, {
      "name": "ServiceDiscoveryResponse",
      "field": [{
        "name": "files",
        "number": 1,
        "label": 1,
        "type": 11,
        "typeName": ".google.protobuf.FileDescriptorSet",
        "extendee": "",
        "defaultValue": "",
        "oneofIndex": 0,
        "jsonName": "files",
        "options": undefined,
        "proto3Optional": false,
      }, {
        "name": "services",
        "number": 2,
        "label": 3,
        "type": 9,
        "typeName": "",
        "extendee": "",
        "defaultValue": "",
        "oneofIndex": 0,
        "jsonName": "services",
        "options": undefined,
        "proto3Optional": false,
      }, {
        "name": "min_protocol_version",
        "number": 3,
        "label": 1,
        "type": 13,
        "typeName": "",
        "extendee": "",
        "defaultValue": "",
        "oneofIndex": 0,
        "jsonName": "minProtocolVersion",
        "options": undefined,
        "proto3Optional": false,
      }, {
        "name": "max_protocol_version",
        "number": 4,
        "label": 1,
        "type": 13,
        "typeName": "",
        "extendee": "",
        "defaultValue": "",
        "oneofIndex": 0,
        "jsonName": "maxProtocolVersion",
        "options": undefined,
        "proto3Optional": false,
      }, {
        "name": "protocol_mode",
        "number": 5,
        "label": 1,
        "type": 14,
        "typeName": ".dev.restate.service.discovery.ProtocolMode",
        "extendee": "",
        "defaultValue": "",
        "oneofIndex": 0,
        "jsonName": "protocolMode",
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
    "enumType": [{
      "name": "ProtocolMode",
      "value": [{ "name": "BIDI_STREAM", "number": 0, "options": undefined }, {
        "name": "REQUEST_RESPONSE",
        "number": 1,
        "options": undefined,
      }],
      "options": undefined,
      "reservedRange": [],
      "reservedName": [],
    }],
    "service": [],
    "extension": [],
    "options": {
      "javaPackage": "com.dev.restate.service.discovery",
      "javaOuterClassname": "DiscoveryProto",
      "javaMultipleFiles": true,
      "javaGenerateEqualsAndHash": false,
      "javaStringCheckUtf8": false,
      "optimizeFor": 1,
      "goPackage": "restate.dev/sdk-go/pb/service/discovery",
      "ccGenericServices": false,
      "javaGenericServices": false,
      "pyGenericServices": false,
      "phpGenericServices": false,
      "deprecated": false,
      "ccEnableArenas": false,
      "objcClassPrefix": "DRSD",
      "csharpNamespace": "Dev.Restate.Service.Discovery",
      "swiftPrefix": "",
      "phpClassPrefix": "",
      "phpNamespace": "Dev\\Restate\\Service\\Discovery",
      "phpMetadataNamespace": "Dev\\Restate\\Service\\Discovery\\GPBMetadata",
      "rubyPackage": "Dev::Restate::Service::Discovery",
      "uninterpretedOption": [],
    },
    "sourceCodeInfo": {
      "location": [{
        "path": [5, 0, 2, 0],
        "span": [19, 2, 18],
        "leadingComments": " protolint:disable:next ENUM_FIELD_NAMES_ZERO_VALUE_END_WITH\n",
        "trailingComments": "",
        "leadingDetachedComments": [],
      }, {
        "path": [4, 1, 2, 0],
        "span": [25, 2, 46],
        "leadingComments": " List of all proto files used to define the services, including the dependencies.\n",
        "trailingComments": "",
        "leadingDetachedComments": [],
      }, {
        "path": [4, 1, 2, 1],
        "span": [28, 2, 31],
        "leadingComments": " List of services to register. This might be a subset of services defined in files.\n",
        "trailingComments": "",
        "leadingDetachedComments": [],
      }, {
        "path": [4, 1, 2, 2],
        "span": [31, 2, 34],
        "leadingComments": " Service-protocol version negotiation\n",
        "trailingComments": "",
        "leadingDetachedComments": [],
      }, {
        "path": [4, 1, 2, 4],
        "span": [35, 2, 33],
        "leadingComments": " Protocol mode negotiation\n",
        "trailingComments": "",
        "leadingDetachedComments": [],
      }],
    },
    "syntax": "proto3",
  }),
  references: {
    ".dev.restate.service.discovery.ProtocolMode": ProtocolMode,
    ".dev.restate.service.discovery.ServiceDiscoveryRequest": ServiceDiscoveryRequest,
    ".dev.restate.service.discovery.ServiceDiscoveryResponse": ServiceDiscoveryResponse,
  },
  dependencies: [protoMetadata1],
};

type Builtin = Date | Function | Uint8Array | string | number | boolean | undefined;

export type DeepPartial<T> = T extends Builtin ? T
  : T extends Array<infer U> ? Array<DeepPartial<U>> : T extends ReadonlyArray<infer U> ? ReadonlyArray<DeepPartial<U>>
  : T extends {} ? { [K in keyof T]?: DeepPartial<T[K]> }
  : Partial<T>;

function isSet(value: any): boolean {
  return value !== null && value !== undefined;
}
