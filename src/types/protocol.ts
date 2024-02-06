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

import {
  SideEffectEntryMessage,
  CombinatorEntryMessage,
} from "../generated/proto/javascript";
import {
  AwakeableEntryMessage,
  BackgroundInvokeEntryMessage,
  ClearStateEntryMessage,
  CompleteAwakeableEntryMessage,
  CompletionMessage,
  EntryAckMessage,
  ErrorMessage,
  EndMessage,
  GetStateEntryMessage,
  InvokeEntryMessage,
  OutputStreamEntryMessage,
  PollInputStreamEntryMessage,
  SetStateEntryMessage,
  SleepEntryMessage,
  StartMessage,
  SuspensionMessage,
} from "../generated/proto/protocol";

// Re-export the protobuf messages.
export {
  AwakeableEntryMessage,
  BackgroundInvokeEntryMessage,
  ClearStateEntryMessage,
  CompleteAwakeableEntryMessage,
  CompletionMessage,
  ErrorMessage,
  EndMessage,
  GetStateEntryMessage,
  InvokeEntryMessage,
  OutputStreamEntryMessage,
  PollInputStreamEntryMessage,
  SetStateEntryMessage,
  SleepEntryMessage,
  StartMessage,
  SuspensionMessage,
  EntryAckMessage,
} from "../generated/proto/protocol";

// Export the protocol message types as defined by the restate protocol.
export const START_MESSAGE_TYPE = 0x0000n;
export const COMPLETION_MESSAGE_TYPE = 0x0001n;
export const SUSPENSION_MESSAGE_TYPE = 0x0002n;
export const ERROR_MESSAGE_TYPE = 0x0003n;
export const ENTRY_ACK_MESSAGE_TYPE = 0x0004n;
export const END_MESSAGE_TYPE = 0x0005n;
export const POLL_INPUT_STREAM_ENTRY_MESSAGE_TYPE = 0x0400n;
export const OUTPUT_STREAM_ENTRY_MESSAGE_TYPE = 0x0401n;
export const GET_STATE_ENTRY_MESSAGE_TYPE = 0x0800n;
export const SET_STATE_ENTRY_MESSAGE_TYPE = 0x0801n;
export const CLEAR_STATE_ENTRY_MESSAGE_TYPE = 0x0802n;
export const SLEEP_ENTRY_MESSAGE_TYPE = 0x0c00n;
export const INVOKE_ENTRY_MESSAGE_TYPE = 0x0c01n;
export const BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE = 0x0c02n;
export const AWAKEABLE_ENTRY_MESSAGE_TYPE = 0x0c03n;
export const COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE = 0x0c04n;

export const AWAKEABLE_IDENTIFIER_PREFIX = "prom_1";

// Export the custom message types
// Side effects are custom messages because the runtime does not need to inspect them
export const SIDE_EFFECT_ENTRY_MESSAGE_TYPE = 0xfc01n;
export const COMBINATOR_ENTRY_MESSAGE = 0xfc02n;

// Restate DuplexStream

// Message types in the protocol.
// Custom message types (per SDK) such as side effect entry message should not be included here.
export const KNOWN_MESSAGE_TYPES = new Set([
  START_MESSAGE_TYPE,
  COMPLETION_MESSAGE_TYPE,
  SUSPENSION_MESSAGE_TYPE,
  ERROR_MESSAGE_TYPE,
  ENTRY_ACK_MESSAGE_TYPE,
  END_MESSAGE_TYPE,
  POLL_INPUT_STREAM_ENTRY_MESSAGE_TYPE,
  OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
  GET_STATE_ENTRY_MESSAGE_TYPE,
  SET_STATE_ENTRY_MESSAGE_TYPE,
  CLEAR_STATE_ENTRY_MESSAGE_TYPE,
  SLEEP_ENTRY_MESSAGE_TYPE,
  INVOKE_ENTRY_MESSAGE_TYPE,
  BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE,
  AWAKEABLE_ENTRY_MESSAGE_TYPE,
  COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE,
  SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
  COMBINATOR_ENTRY_MESSAGE,
]);

const PROTOBUF_MESSAGE_NAME_BY_TYPE = new Map<bigint, string>([
  [START_MESSAGE_TYPE, "StartMessage"],
  [COMPLETION_MESSAGE_TYPE, "CompletionMessage"],
  [SUSPENSION_MESSAGE_TYPE, "SuspensionMessage"],
  [ERROR_MESSAGE_TYPE, "ErrorMessage"],
  [ENTRY_ACK_MESSAGE_TYPE, "EntryAckMessage"],
  [END_MESSAGE_TYPE, "EndMessage"],
  [POLL_INPUT_STREAM_ENTRY_MESSAGE_TYPE, "PollInputStreamEntryMessage"],
  [OUTPUT_STREAM_ENTRY_MESSAGE_TYPE, "OutputStreamEntryMessage"],
  [GET_STATE_ENTRY_MESSAGE_TYPE, "GetStateEntryMessage"],
  [SET_STATE_ENTRY_MESSAGE_TYPE, "SetStateEntryMessage"],
  [CLEAR_STATE_ENTRY_MESSAGE_TYPE, "ClearStateEntryMessage"],
  [SLEEP_ENTRY_MESSAGE_TYPE, "SleepEntryMessage"],
  [INVOKE_ENTRY_MESSAGE_TYPE, "InvokeEntryMessage"],
  [BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE, "BackgroundInvokeEntryMessage"],
  [AWAKEABLE_ENTRY_MESSAGE_TYPE, "AwakeableEntryMessage"],
  [COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE, "CompleteAwakeableEntryMessage"],
  [SIDE_EFFECT_ENTRY_MESSAGE_TYPE, "SideEffectEntryMessage"],
  [COMBINATOR_ENTRY_MESSAGE, "CombinatorEntryMessage"],
]);

export function formatMessageType(messageType: bigint) {
  return (
    PROTOBUF_MESSAGE_NAME_BY_TYPE.get(messageType) || messageType.toString()
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PROTOBUF_MESSAGES: Array<[bigint, any]> = [
  [START_MESSAGE_TYPE, StartMessage],
  [COMPLETION_MESSAGE_TYPE, CompletionMessage],
  [SUSPENSION_MESSAGE_TYPE, SuspensionMessage],
  [ERROR_MESSAGE_TYPE, ErrorMessage],
  [ENTRY_ACK_MESSAGE_TYPE, EntryAckMessage],
  [END_MESSAGE_TYPE, EndMessage],
  [POLL_INPUT_STREAM_ENTRY_MESSAGE_TYPE, PollInputStreamEntryMessage],
  [OUTPUT_STREAM_ENTRY_MESSAGE_TYPE, OutputStreamEntryMessage],
  [GET_STATE_ENTRY_MESSAGE_TYPE, GetStateEntryMessage],
  [SET_STATE_ENTRY_MESSAGE_TYPE, SetStateEntryMessage],
  [CLEAR_STATE_ENTRY_MESSAGE_TYPE, ClearStateEntryMessage],
  [SLEEP_ENTRY_MESSAGE_TYPE, SleepEntryMessage],
  [INVOKE_ENTRY_MESSAGE_TYPE, InvokeEntryMessage],
  [BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE, BackgroundInvokeEntryMessage],
  [AWAKEABLE_ENTRY_MESSAGE_TYPE, AwakeableEntryMessage],
  [COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE, CompleteAwakeableEntryMessage],
  [SIDE_EFFECT_ENTRY_MESSAGE_TYPE, SideEffectEntryMessage],
  [COMBINATOR_ENTRY_MESSAGE, CombinatorEntryMessage],
];

export const PROTOBUF_MESSAGE_BY_TYPE = new Map(PROTOBUF_MESSAGES);

export type ProtocolMessage =
  | StartMessage
  | CompletionMessage
  | SuspensionMessage
  | ErrorMessage
  | EntryAckMessage
  | EndMessage
  | PollInputStreamEntryMessage
  | OutputStreamEntryMessage
  | GetStateEntryMessage
  | SetStateEntryMessage
  | ClearStateEntryMessage
  | SleepEntryMessage
  | InvokeEntryMessage
  | BackgroundInvokeEntryMessage
  | AwakeableEntryMessage
  | CompleteAwakeableEntryMessage
  | SideEffectEntryMessage
  | CombinatorEntryMessage;

// These message types will trigger sending a suspension message from the runtime
// for each of the protocol modes
export const SUSPENSION_TRIGGERS: bigint[] = [
  INVOKE_ENTRY_MESSAGE_TYPE,
  GET_STATE_ENTRY_MESSAGE_TYPE,
  AWAKEABLE_ENTRY_MESSAGE_TYPE,
  SLEEP_ENTRY_MESSAGE_TYPE,
  COMBINATOR_ENTRY_MESSAGE,
  // We need it because of the ack
  SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
];
