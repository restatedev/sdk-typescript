"use strict";

import {
  BackgroundInvokeEntryMessage,
  ClearStateEntryMessage,
  CompleteAwakeableEntryMessage,
  GetStateEntryMessage,
  InvokeEntryMessage,
  SetStateEntryMessage,
  SleepEntryMessage,
} from "../generated/proto/protocol";

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
  const uuid = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `${uuid.slice(0, 8)}-${uuid.slice(8, 12)}-${uuid.slice(
    12,
    16
  )}-${uuid.slice(16, 20)}-${uuid.slice(20)}`;
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
    msg1.entryIndex === msg2.entryIndex
  );
};

export const sleepMsgEquality = (
  msg1: SleepEntryMessage,
  msg2: SleepEntryMessage
) => {
  return msg1.wakeUpTime === msg2.wakeUpTime;
};
