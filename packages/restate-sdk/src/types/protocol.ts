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

import type { Message } from "@bufbuild/protobuf";
import { CombinatorEntryMessage } from "../generated/proto/javascript_pb";
import {
  AwakeableEntryMessage,
  OneWayCallEntryMessage,
  ClearStateEntryMessage,
  ClearAllStateEntryMessage,
  CompleteAwakeableEntryMessage,
  CompletionMessage,
  EntryAckMessage,
  ErrorMessage,
  EndMessage,
  GetStateEntryMessage,
  GetStateKeysEntryMessage,
  CallEntryMessage,
  OutputEntryMessage,
  InputEntryMessage,
  SetStateEntryMessage,
  SleepEntryMessage,
  StartMessage,
  SuspensionMessage,
  RunEntryMessage,
  GetPromiseEntryMessage,
  PeekPromiseEntryMessage,
  CompletePromiseEntryMessage,
  ServiceProtocolVersion,
} from "../generated/proto/protocol_pb";
import { ServiceDiscoveryProtocolVersion } from "../generated/proto/discovery_pb";

// Re-export the protobuf messages.
export {
  AwakeableEntryMessage,
  OneWayCallEntryMessage,
  ClearStateEntryMessage,
  ClearAllStateEntryMessage,
  CompleteAwakeableEntryMessage,
  CompletionMessage,
  ErrorMessage,
  EndMessage,
  GetStateEntryMessage,
  GetStateKeysEntryMessage,
  CallEntryMessage,
  OutputEntryMessage,
  InputEntryMessage,
  SetStateEntryMessage,
  SleepEntryMessage,
  StartMessage,
  SuspensionMessage,
  EntryAckMessage,
  GetPromiseEntryMessage,
  PeekPromiseEntryMessage,
  CompletePromiseEntryMessage,
} from "../generated/proto/protocol_pb";

// Export the protocol message types as defined by the restate protocol.
export const START_MESSAGE_TYPE = 0x0000n;
export const COMPLETION_MESSAGE_TYPE = 0x0001n;
export const SUSPENSION_MESSAGE_TYPE = 0x0002n;
export const ERROR_MESSAGE_TYPE = 0x0003n;
export const ENTRY_ACK_MESSAGE_TYPE = 0x0004n;
export const END_MESSAGE_TYPE = 0x0005n;
export const INPUT_ENTRY_MESSAGE_TYPE = 0x0400n;
export const OUTPUT_ENTRY_MESSAGE_TYPE = 0x0401n;
export const GET_STATE_ENTRY_MESSAGE_TYPE = 0x0800n;
export const SET_STATE_ENTRY_MESSAGE_TYPE = 0x0801n;
export const CLEAR_STATE_ENTRY_MESSAGE_TYPE = 0x0802n;
export const CLEAR_ALL_STATE_ENTRY_MESSAGE_TYPE = 0x0803n;
export const GET_STATE_KEYS_ENTRY_MESSAGE_TYPE = 0x0804n;
export const SLEEP_ENTRY_MESSAGE_TYPE = 0x0c00n;
export const INVOKE_ENTRY_MESSAGE_TYPE = 0x0c01n;
export const BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE = 0x0c02n;
export const AWAKEABLE_ENTRY_MESSAGE_TYPE = 0x0c03n;
export const COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE = 0x0c04n;

export const AWAKEABLE_IDENTIFIER_PREFIX = "prom_1";

export const SIDE_EFFECT_ENTRY_MESSAGE_TYPE = 0x0c00n + 5n;

// Export the custom message types
// Side effects are custom messages because the runtime does not need to inspect them
export const COMBINATOR_ENTRY_MESSAGE = 0xfc02n;

// Durable promise
export const GET_PROMISE_MESSAGE_TYPE = 0x808n;
export const PEEK_PROMISE_MESSAGE_TYPE = 0x809n;
export const COMPLETE_PROMISE_MESSAGE_TYPE = 0x80an;

// Message types in the protocol.
// Custom message types (per SDK) such as side effect entry message should not be included here.
export const KNOWN_MESSAGE_TYPES = new Set([
  START_MESSAGE_TYPE,
  COMPLETION_MESSAGE_TYPE,
  SUSPENSION_MESSAGE_TYPE,
  ERROR_MESSAGE_TYPE,
  ENTRY_ACK_MESSAGE_TYPE,
  END_MESSAGE_TYPE,
  INPUT_ENTRY_MESSAGE_TYPE,
  OUTPUT_ENTRY_MESSAGE_TYPE,
  GET_STATE_ENTRY_MESSAGE_TYPE,
  GET_STATE_KEYS_ENTRY_MESSAGE_TYPE,
  SET_STATE_ENTRY_MESSAGE_TYPE,
  CLEAR_STATE_ENTRY_MESSAGE_TYPE,
  CLEAR_ALL_STATE_ENTRY_MESSAGE_TYPE,
  SLEEP_ENTRY_MESSAGE_TYPE,
  INVOKE_ENTRY_MESSAGE_TYPE,
  BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE,
  AWAKEABLE_ENTRY_MESSAGE_TYPE,
  COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE,
  SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
  COMBINATOR_ENTRY_MESSAGE,
  GET_PROMISE_MESSAGE_TYPE,
  PEEK_PROMISE_MESSAGE_TYPE,
  COMPLETE_PROMISE_MESSAGE_TYPE,
]);

const PROTOBUF_MESSAGE_NAME_BY_TYPE = new Map<bigint, string>([
  [START_MESSAGE_TYPE, "StartMessage"],
  [COMPLETION_MESSAGE_TYPE, "CompletionMessage"],
  [SUSPENSION_MESSAGE_TYPE, "SuspensionMessage"],
  [ERROR_MESSAGE_TYPE, "ErrorMessage"],
  [ENTRY_ACK_MESSAGE_TYPE, "EntryAckMessage"],
  [END_MESSAGE_TYPE, "EndMessage"],
  [INPUT_ENTRY_MESSAGE_TYPE, "InputEntryMessage"],
  [OUTPUT_ENTRY_MESSAGE_TYPE, "OutputEntryMessage"],
  [GET_STATE_ENTRY_MESSAGE_TYPE, "GetStateEntryMessage"],
  [GET_STATE_KEYS_ENTRY_MESSAGE_TYPE, "GetStateKeysEntryMessage"],
  [SET_STATE_ENTRY_MESSAGE_TYPE, "SetStateEntryMessage"],
  [CLEAR_STATE_ENTRY_MESSAGE_TYPE, "ClearStateEntryMessage"],
  [CLEAR_ALL_STATE_ENTRY_MESSAGE_TYPE, "ClearAllStateEntryMessage"],
  [SLEEP_ENTRY_MESSAGE_TYPE, "SleepEntryMessage"],
  [INVOKE_ENTRY_MESSAGE_TYPE, "CallEntryMessage"],
  [BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE, "OneWayCallEntryMessage"],
  [AWAKEABLE_ENTRY_MESSAGE_TYPE, "AwakeableEntryMessage"],
  [COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE, "CompleteAwakeableEntryMessage"],
  [SIDE_EFFECT_ENTRY_MESSAGE_TYPE, "RunEntryMessage"],
  [COMBINATOR_ENTRY_MESSAGE, "CombinatorEntryMessage"],
  [GET_PROMISE_MESSAGE_TYPE, "GetPromiseEntryMessage"],
  [PEEK_PROMISE_MESSAGE_TYPE, "PeekPromiseEntryMessage"],
  [COMPLETE_PROMISE_MESSAGE_TYPE, "CompletePromiseEntryMessage"],
]);

export const formatMessageType = (messageType: bigint) => {
  return (
    PROTOBUF_MESSAGE_NAME_BY_TYPE.get(messageType) ?? messageType.toString()
  );
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PROTOBUF_MESSAGES: Array<[bigint, typeof Message<any>]> = [
  [START_MESSAGE_TYPE, StartMessage],
  [COMPLETION_MESSAGE_TYPE, CompletionMessage],
  [SUSPENSION_MESSAGE_TYPE, SuspensionMessage],
  [ERROR_MESSAGE_TYPE, ErrorMessage],
  [ENTRY_ACK_MESSAGE_TYPE, EntryAckMessage],
  [END_MESSAGE_TYPE, EndMessage],
  [INPUT_ENTRY_MESSAGE_TYPE, InputEntryMessage],
  [OUTPUT_ENTRY_MESSAGE_TYPE, OutputEntryMessage],
  [GET_STATE_ENTRY_MESSAGE_TYPE, GetStateEntryMessage],
  [GET_STATE_KEYS_ENTRY_MESSAGE_TYPE, GetStateKeysEntryMessage],
  [SET_STATE_ENTRY_MESSAGE_TYPE, SetStateEntryMessage],
  [CLEAR_STATE_ENTRY_MESSAGE_TYPE, ClearStateEntryMessage],
  [CLEAR_ALL_STATE_ENTRY_MESSAGE_TYPE, ClearAllStateEntryMessage],
  [SLEEP_ENTRY_MESSAGE_TYPE, SleepEntryMessage],
  [INVOKE_ENTRY_MESSAGE_TYPE, CallEntryMessage],
  [BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE, OneWayCallEntryMessage],
  [AWAKEABLE_ENTRY_MESSAGE_TYPE, AwakeableEntryMessage],
  [COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE, CompleteAwakeableEntryMessage],
  [SIDE_EFFECT_ENTRY_MESSAGE_TYPE, RunEntryMessage],
  [COMBINATOR_ENTRY_MESSAGE, CombinatorEntryMessage],
  [GET_PROMISE_MESSAGE_TYPE, GetPromiseEntryMessage],
  [PEEK_PROMISE_MESSAGE_TYPE, PeekPromiseEntryMessage],
  [COMPLETE_PROMISE_MESSAGE_TYPE, CompletePromiseEntryMessage],
];

export const PROTOBUF_MESSAGE_BY_TYPE = new Map(PROTOBUF_MESSAGES);

export type ProtocolMessage =
  | StartMessage
  | CompletionMessage
  | SuspensionMessage
  | ErrorMessage
  | EntryAckMessage
  | EndMessage
  | InputEntryMessage
  | OutputEntryMessage
  | GetStateEntryMessage
  | GetStateKeysEntryMessage
  | SetStateEntryMessage
  | ClearStateEntryMessage
  | ClearAllStateEntryMessage
  | SleepEntryMessage
  | CallEntryMessage
  | OneWayCallEntryMessage
  | AwakeableEntryMessage
  | CompleteAwakeableEntryMessage
  | RunEntryMessage
  | CombinatorEntryMessage
  | GetPromiseEntryMessage
  | PeekPromiseEntryMessage
  | CompletePromiseEntryMessage;

// These message types will trigger sending a suspension message from the runtime
// for each of the protocol modes
export const SUSPENSION_TRIGGERS: bigint[] = [
  INVOKE_ENTRY_MESSAGE_TYPE,
  GET_STATE_ENTRY_MESSAGE_TYPE,
  GET_STATE_KEYS_ENTRY_MESSAGE_TYPE,
  AWAKEABLE_ENTRY_MESSAGE_TYPE,
  SLEEP_ENTRY_MESSAGE_TYPE,
  COMBINATOR_ENTRY_MESSAGE,
  // We need it because of the ack
  SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
  // promises need completion
  GET_PROMISE_MESSAGE_TYPE,
  PEEK_PROMISE_MESSAGE_TYPE,
  COMPLETE_PROMISE_MESSAGE_TYPE,
];

const MIN_SERVICE_PROTOCOL_VERSION: ServiceProtocolVersion =
  ServiceProtocolVersion.V1;
const MAX_SERVICE_PROTOCOL_VERSION: ServiceProtocolVersion =
  ServiceProtocolVersion.V1;

const MIN_SERVICE_DISCOVERY_PROTOCOL_VERSION: ServiceDiscoveryProtocolVersion =
  ServiceDiscoveryProtocolVersion.V1;
const MAX_SERVICE_DISCOVERY_PROTOCOL_VERSION: ServiceDiscoveryProtocolVersion =
  ServiceDiscoveryProtocolVersion.V1;

export function isServiceProtocolVersionSupported(
  version: ServiceProtocolVersion
) {
  return (
    version >= MIN_SERVICE_PROTOCOL_VERSION &&
    version <= MAX_SERVICE_PROTOCOL_VERSION
  );
}

function isServiceDiscoveryProtocolVersionSupported(
  version: ServiceDiscoveryProtocolVersion
) {
  return (
    version >= MIN_SERVICE_DISCOVERY_PROTOCOL_VERSION &&
    version <= MAX_SERVICE_DISCOVERY_PROTOCOL_VERSION
  );
}

export function parseServiceProtocolVersion(
  versionString: string | undefined
): ServiceProtocolVersion {
  // if nothing is set, assume we are using V1
  if (
    versionString === undefined ||
    versionString === null ||
    versionString === ""
  ) {
    return ServiceProtocolVersion.V1;
  }

  versionString = versionString.trim();

  if (versionString === "application/vnd.restate.invocation.v1") {
    return ServiceProtocolVersion.V1;
  }

  return ServiceProtocolVersion.SERVICE_PROTOCOL_VERSION_UNSPECIFIED;
}

export function serviceProtocolVersionToHeaderValue(
  serviceProtocolVersion: ServiceProtocolVersion
): string {
  switch (serviceProtocolVersion) {
    case ServiceProtocolVersion.V1:
      return "application/vnd.restate.invocation.v1";
    default:
      throw new Error(
        `Unsupported service discovery protocol version: ${serviceProtocolVersion}`
      );
  }
}

function parseServiceDiscoveryProtocolVersion(
  versionString: string
): ServiceDiscoveryProtocolVersion {
  versionString = versionString.trim();
  if (versionString === "application/vnd.restate.endpointmanifest.v1+json") {
    return ServiceDiscoveryProtocolVersion.V1;
  }

  return ServiceDiscoveryProtocolVersion.SERVICE_DISCOVERY_PROTOCOL_VERSION_UNSPECIFIED;
}

export function serviceDiscoveryProtocolVersionToHeaderValue(
  serviceDiscoveryProtocolVersion: ServiceDiscoveryProtocolVersion
): string {
  switch (serviceDiscoveryProtocolVersion) {
    case ServiceDiscoveryProtocolVersion.V1:
      return "application/vnd.restate.endpointmanifest.v1+json";
    default:
      throw new Error(
        `Unsupported service discovery protocol version: ${serviceDiscoveryProtocolVersion}`
      );
  }
}

export function selectSupportedServiceDiscoveryProtocolVersion(
  acceptVersionsString: string | undefined
): ServiceDiscoveryProtocolVersion {
  if (
    acceptVersionsString === undefined ||
    acceptVersionsString === null ||
    acceptVersionsString === ""
  ) {
    return ServiceDiscoveryProtocolVersion.V1;
  }

  let maxVersion =
    ServiceDiscoveryProtocolVersion.SERVICE_DISCOVERY_PROTOCOL_VERSION_UNSPECIFIED;

  acceptVersionsString.split(",").forEach((versionString) => {
    const version = parseServiceDiscoveryProtocolVersion(versionString);
    if (
      isServiceDiscoveryProtocolVersionSupported(version) &&
      version > maxVersion
    ) {
      maxVersion = version;
    }
  });

  return maxVersion;
}
