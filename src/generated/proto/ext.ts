/* eslint-disable */
import { FileDescriptorProto as FileDescriptorProto1 } from "ts-proto-descriptors";
import { protoMetadata as protoMetadata1 } from "../google/protobuf/descriptor";

export const protobufPackage = "dev.restate.ext";

/** This package provides user facing Restate extensions, which the user can include in their own contracts */

export enum ServiceType {
  /** UNKEYED - protolint:disable:next ENUM_FIELD_NAMES_ZERO_VALUE_END_WITH */
  UNKEYED = 0,
  KEYED = 1,
  SINGLETON = 2,
  UNRECOGNIZED = -1,
}

export function serviceTypeFromJSON(object: any): ServiceType {
  switch (object) {
    case 0:
    case "UNKEYED":
      return ServiceType.UNKEYED;
    case 1:
    case "KEYED":
      return ServiceType.KEYED;
    case 2:
    case "SINGLETON":
      return ServiceType.SINGLETON;
    case -1:
    case "UNRECOGNIZED":
    default:
      return ServiceType.UNRECOGNIZED;
  }
}

export function serviceTypeToJSON(object: ServiceType): string {
  switch (object) {
    case ServiceType.UNKEYED:
      return "UNKEYED";
    case ServiceType.KEYED:
      return "KEYED";
    case ServiceType.SINGLETON:
      return "SINGLETON";
    case ServiceType.UNRECOGNIZED:
    default:
      return "UNRECOGNIZED";
  }
}

export enum FieldType {
  /** KEY - protolint:disable:next ENUM_FIELD_NAMES_ZERO_VALUE_END_WITH */
  KEY = 0,
  UNRECOGNIZED = -1,
}

export function fieldTypeFromJSON(object: any): FieldType {
  switch (object) {
    case 0:
    case "KEY":
      return FieldType.KEY;
    case -1:
    case "UNRECOGNIZED":
    default:
      return FieldType.UNRECOGNIZED;
  }
}

export function fieldTypeToJSON(object: FieldType): string {
  switch (object) {
    case FieldType.KEY:
      return "KEY";
    case FieldType.UNRECOGNIZED:
    default:
      return "UNRECOGNIZED";
  }
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
    "name": "proto/ext.proto",
    "package": "dev.restate.ext",
    "dependency": ["google/protobuf/descriptor.proto"],
    "publicDependency": [],
    "weakDependency": [],
    "messageType": [],
    "enumType": [{
      "name": "ServiceType",
      "value": [{ "name": "UNKEYED", "number": 0, "options": undefined }, {
        "name": "KEYED",
        "number": 1,
        "options": undefined,
      }, { "name": "SINGLETON", "number": 2, "options": undefined }],
      "options": undefined,
      "reservedRange": [],
      "reservedName": [],
    }, {
      "name": "FieldType",
      "value": [{ "name": "KEY", "number": 0, "options": undefined }],
      "options": undefined,
      "reservedRange": [],
      "reservedName": [],
    }],
    "service": [],
    "extension": [{
      "name": "service_type",
      "number": 51234,
      "label": 1,
      "type": 14,
      "typeName": ".dev.restate.ext.ServiceType",
      "extendee": ".google.protobuf.ServiceOptions",
      "defaultValue": "",
      "oneofIndex": 0,
      "jsonName": "serviceType",
      "options": undefined,
      "proto3Optional": true,
    }, {
      "name": "field",
      "number": 51234,
      "label": 1,
      "type": 14,
      "typeName": ".dev.restate.ext.FieldType",
      "extendee": ".google.protobuf.FieldOptions",
      "defaultValue": "",
      "oneofIndex": 0,
      "jsonName": "field",
      "options": undefined,
      "proto3Optional": true,
    }],
    "options": {
      "javaPackage": "com.dev.restate.ext",
      "javaOuterClassname": "ExtProto",
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
      "objcClassPrefix": "DRE",
      "csharpNamespace": "Dev.Restate.Ext",
      "swiftPrefix": "",
      "phpClassPrefix": "",
      "phpNamespace": "Dev\\Restate\\Ext",
      "phpMetadataNamespace": "Dev\\Restate\\Ext\\GPBMetadata",
      "rubyPackage": "Dev::Restate::Ext",
      "uninterpretedOption": [],
    },
    "sourceCodeInfo": {
      "location": [{
        "path": [12],
        "span": [3, 0, 18],
        "leadingComments":
          "\n This package provides user facing Restate extensions, which the user can include in their own contracts\n",
        "trailingComments": "",
        "leadingDetachedComments": [],
      }, {
        "path": [5, 0, 2, 0],
        "span": [11, 2, 14],
        "leadingComments": " protolint:disable:next ENUM_FIELD_NAMES_ZERO_VALUE_END_WITH\n",
        "trailingComments": "",
        "leadingDetachedComments": [],
      }, {
        "path": [5, 1, 2, 0],
        "span": [18, 2, 10],
        "leadingComments": " protolint:disable:next ENUM_FIELD_NAMES_ZERO_VALUE_END_WITH\n",
        "trailingComments": "",
        "leadingDetachedComments": [],
      }],
    },
    "syntax": "proto3",
  }),
  references: { ".dev.restate.ext.ServiceType": ServiceType, ".dev.restate.ext.FieldType": FieldType },
  dependencies: [protoMetadata1],
};
