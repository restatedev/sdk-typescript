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

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  OneWayCallEntryMessage,
  ClearStateEntryMessage,
  CompleteAwakeableEntryMessage,
  GetStateEntryMessage,
  CallEntryMessage,
  OutputEntryMessage,
  SetStateEntryMessage,
} from "../generated/proto/protocol_pb";
import {
  AWAKEABLE_ENTRY_MESSAGE_TYPE,
  BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE,
  CLEAR_STATE_ENTRY_MESSAGE_TYPE,
  COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE,
  GET_STATE_ENTRY_MESSAGE_TYPE,
  INVOKE_ENTRY_MESSAGE_TYPE,
  OUTPUT_ENTRY_MESSAGE_TYPE,
  SET_STATE_ENTRY_MESSAGE_TYPE,
  SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
  SLEEP_ENTRY_MESSAGE_TYPE,
} from "../types/protocol";
import { Buffer } from "node:buffer";

export function jsonSerialize(obj: any): string {
  return JSON.stringify(obj, (_, v): any =>
    typeof v === "bigint" ? "BIGINT::" + v.toString() : v
  );
}

export function jsonDeserialize<T>(json: string): T {
  return JSON.parse(json, (_, v): any =>
    typeof v === "string" && v.startsWith("BIGINT::")
      ? BigInt(v.substring(8))
      : v
  ) as T;
}

export function formatMessageAsJson(obj: any): string {
  const newObj = { ...(obj as Record<string, unknown>) };
  for (const [key, value] of Object.entries(newObj)) {
    if (Buffer.isBuffer(value)) {
      newObj[key] = value.toString().trim();
    }
  }
  // Stringify object. Replace bigintToString serializer to prevent "BigInt not serializable" errors
  return JSON.stringify(obj, (_, v): any =>
    typeof v === "bigint" ? v.toString() + "n" : v
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

const eq = (a: Uint8Array, b: Uint8Array): boolean => {
  const n = a.length;
  const m = b.length;
  if (n !== m) {
    return false;
  }
  for (let i = 0; i < n; i++) {
    if (a.at(i) !== b.at(i)) {
      return false;
    }
  }
  return true;
};

const getStateMsgEquality = (
  msg1: GetStateEntryMessage,
  msg2: GetStateEntryMessage
) => {
  return eq(msg1.key, msg2.key);
};

const invokeMsgEquality = (
  msg1: CallEntryMessage | OneWayCallEntryMessage,
  msg2: CallEntryMessage | OneWayCallEntryMessage
) => {
  return (
    msg1.serviceName === msg2.serviceName &&
    msg1.handlerName === msg2.handlerName &&
    eq(msg1.parameter, msg2.parameter)
  );
};

const setStateMsgEquality = (
  msg1: SetStateEntryMessage,
  msg2: SetStateEntryMessage
) => {
  return eq(msg1.key, msg2.key) && eq(msg1.value, msg2.value);
};

const clearStateMsgEquality = (
  msg1: ClearStateEntryMessage,
  msg2: ClearStateEntryMessage
) => {
  return eq(msg1.key, msg2.key);
};

const completeAwakeableMsgEquality = (
  msg1: CompleteAwakeableEntryMessage,
  msg2: CompleteAwakeableEntryMessage
) => {
  if (!(msg1.id === msg2.id)) {
    return false;
  }

  if (
    msg1.result.case === "value" &&
    msg2.result.case === "value" &&
    eq(msg1.result.value, msg2.result.value)
  ) {
    return true;
  } else if (msg1.result.case === "failure" && msg2.result.case === "failure") {
    return (
      msg1.result.value.code === msg2.result.value.code &&
      msg1.result.value.message === msg2.result.value.message
    );
  } else {
    return false;
  }
};

const outputMsgEquality = (
  msg1: OutputEntryMessage,
  msg2: OutputEntryMessage
) => {
  if (
    msg1.result.case === "value" &&
    msg2.result.case === "value" &&
    eq(msg1.result.value, msg2.result.value)
  ) {
    return true;
  } else if (msg1.result.case === "failure" && msg2.result.case === "failure") {
    return (
      msg1.result.value.code === msg2.result.value.code &&
      msg1.result.value.message === msg2.result.value.message
    );
  } else {
    return false;
  }
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
  [OUTPUT_ENTRY_MESSAGE_TYPE, outputMsgEquality],
  [AWAKEABLE_ENTRY_MESSAGE_TYPE, () => true],
  [SIDE_EFFECT_ENTRY_MESSAGE_TYPE, () => true],
  [SLEEP_ENTRY_MESSAGE_TYPE, () => true],
]);
