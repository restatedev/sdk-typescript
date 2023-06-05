"use strict";

import {
  BackgroundInvokeEntryMessage,
  ClearStateEntryMessage,
  CompleteAwakeableEntryMessage,
  GetStateEntryMessage,
  InvokeEntryMessage,
  OutputStreamEntryMessage,
  SetStateEntryMessage,
} from "../generated/proto/protocol";
import {
  AWAKEABLE_ENTRY_MESSAGE_TYPE,
  BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE,
  CLEAR_STATE_ENTRY_MESSAGE_TYPE,
  COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE,
  GET_STATE_ENTRY_MESSAGE_TYPE,
  INVOKE_ENTRY_MESSAGE_TYPE,
  OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
  SET_STATE_ENTRY_MESSAGE_TYPE,
  SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
  SLEEP_ENTRY_MESSAGE_TYPE,
} from "../types/protocol";

/* eslint-disable @typescript-eslint/no-explicit-any */
export function printMessageAsJson(obj: any): string {
  const newObj = { ...(obj as Record<string, unknown>) };
  for (const [key, value] of Object.entries(newObj)) {
    if (Buffer.isBuffer(value)) {
      newObj[key] = value.toString().trim();
    }
  }
  return JSON.stringify(newObj);
}

// Only used for logging the invocation ID in debug logging mode
export function uuidV7FromBuffer(buffer: Buffer): string {
  // if (buffer.length !== 16) {
  //   throw new Error('Invalid UUIDv7 buffer length');
  // }
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
}

/**
 * Equality functions
 * @param msg1 the current message from user code
 * @param msg2 the replayed message
 */
// These functions are used to check whether a replayed message matches the current user code.
// We check the fields which we can check
// (the fields which do not contain results, because these might be filled in the result)

export const getStateMsgEquality = (
  msg1: GetStateEntryMessage,
  msg2: GetStateEntryMessage
) => {
  return msg1.key.equals(msg2.key);
};

export const invokeMsgEquality = (
  msg1: InvokeEntryMessage | BackgroundInvokeEntryMessage,
  msg2: InvokeEntryMessage | BackgroundInvokeEntryMessage
) => {
  return (
    msg1.serviceName === msg2.serviceName &&
    msg1.methodName === msg2.methodName &&
    msg1.parameter.equals(msg2.parameter)
  );
};

export const setStateMsgEquality = (
  msg1: SetStateEntryMessage,
  msg2: SetStateEntryMessage
) => {
  return msg1.key.equals(msg2.key) && msg1.value.equals(msg2.value);
};

export const clearStateMsgEquality = (
  msg1: ClearStateEntryMessage,
  msg2: ClearStateEntryMessage
) => {
  return msg1.key.equals(msg2.key);
};

export const completeAwakeableMsgEquality = (
  msg1: CompleteAwakeableEntryMessage,
  msg2: CompleteAwakeableEntryMessage
) => {
  return (
    msg1.serviceName === msg2.serviceName &&
    msg1.instanceKey.equals(msg2.instanceKey) &&
    msg1.invocationId.equals(msg2.invocationId) &&
    msg1.entryIndex === msg2.entryIndex &&
    msg1.payload.equals(msg2.payload)
  );
};

const outputMsgEquality = (
  msg1: OutputStreamEntryMessage,
  msg2: OutputStreamEntryMessage
) => {
  return msg1.value === msg2.value && msg1.failure === msg2.failure;
};

export const equalityCheckers = new Map<
  bigint,
  (msg1: any, msg2: any) => boolean
>([
  [GET_STATE_ENTRY_MESSAGE_TYPE, getStateMsgEquality],
  [SET_STATE_ENTRY_MESSAGE_TYPE, setStateMsgEquality],
  [CLEAR_STATE_ENTRY_MESSAGE_TYPE, clearStateMsgEquality],
  [INVOKE_ENTRY_MESSAGE_TYPE, invokeMsgEquality],
  [BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE, invokeMsgEquality],
  [COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE, completeAwakeableMsgEquality],
  [OUTPUT_STREAM_ENTRY_MESSAGE_TYPE, outputMsgEquality],
  [AWAKEABLE_ENTRY_MESSAGE_TYPE, () => true],
  [SIDE_EFFECT_ENTRY_MESSAGE_TYPE, () => true],
  [SLEEP_ENTRY_MESSAGE_TYPE, () => true],
]);
