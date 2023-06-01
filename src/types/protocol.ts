"use strict";

import {
  AwakeableEntryMessage,
  BackgroundInvokeEntryMessage,
  ClearStateEntryMessage,
  CompleteAwakeableEntryMessage,
  CompletionMessage,
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
  GetStateEntryMessage,
  InvokeEntryMessage,
  OutputStreamEntryMessage,
  PollInputStreamEntryMessage,
  SetStateEntryMessage,
  SleepEntryMessage,
  StartMessage,
  SuspensionMessage,
} from "../generated/proto/protocol";

// Export the protocol message types as defined by the restate protocol.
export const START_MESSAGE_TYPE = 0x0000n;
export const COMPLETION_MESSAGE_TYPE = 0x0001n;
export const SUSPENSION_MESSAGE_TYPE = 0x0002n;
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

// Restate DuplexStream

// Message types in the protocol.
// Custom message types (per SDK) such as side effect entry message should not be included here.
export const KNOWN_MESSAGE_TYPES = new Set([
  START_MESSAGE_TYPE,
  COMPLETION_MESSAGE_TYPE,
  SUSPENSION_MESSAGE_TYPE,
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
]);

export const PROTOBUF_MESSAGE_NAME_BY_TYPE = new Map<bigint, string>([
  [START_MESSAGE_TYPE, "StartMessage"],
  [COMPLETION_MESSAGE_TYPE, "CompletionMessage"],
  [SUSPENSION_MESSAGE_TYPE, "SuspensionMessage"],
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
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PROTOBUF_MESSAGES: Array<[bigint, any]> = [
  [START_MESSAGE_TYPE, StartMessage],
  [COMPLETION_MESSAGE_TYPE, CompletionMessage],
  [SUSPENSION_MESSAGE_TYPE, SuspensionMessage],
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
];

export const PROTOBUF_MESSAGE_BY_TYPE = new Map(PROTOBUF_MESSAGES);

export type ProtocolMessage =
  | StartMessage
  | CompletionMessage
  | SuspensionMessage
  | PollInputStreamEntryMessage
  | OutputStreamEntryMessage
  | GetStateEntryMessage
  | SetStateEntryMessage
  | ClearStateEntryMessage
  | SleepEntryMessage
  | InvokeEntryMessage
  | BackgroundInvokeEntryMessage
  | AwakeableEntryMessage
  | CompleteAwakeableEntryMessage;

// Export the custom message types
// Side effects are custom messages because the runtime does not need to inspect them
export const SIDE_EFFECT_ENTRY_MESSAGE_TYPE = 0xfc01n;

export class AwakeableIdentifier {
  constructor(
    readonly serviceName: string,
    readonly instanceKey: Buffer,
    readonly invocationId: Buffer,
    readonly entryIndex: number
  ) {}
}

// These message types will trigger sending a suspension message from the runtime
// for each of the protocol modes
export const SUSPENSION_TRIGGERS: bigint[] = [
  INVOKE_ENTRY_MESSAGE_TYPE,
  GET_STATE_ENTRY_MESSAGE_TYPE,
  SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
  AWAKEABLE_ENTRY_MESSAGE_TYPE,
  SLEEP_ENTRY_MESSAGE_TYPE,
];
