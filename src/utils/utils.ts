/*
 * Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
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

export class CompletablePromise<T> {
  private success!: (value: T | PromiseLike<T>) => void;
  private failure!: (reason?: any) => void;

  public readonly promise: Promise<T>;

  constructor() {
    this.promise = new Promise((resolve, reject) => {
      this.success = resolve;
      this.failure = reject;
    });
  }

  public resolve(value: T) {
    this.success(value);
  }

  public reject(reason?: any) {
    this.failure(reason);
  }
}

export function jsonSerialize(obj: any): string {
  return JSON.stringify(obj, (_, v) =>
    typeof v === "bigint" ? "BIGINT::" + v.toString() : v
  );
}

export function jsonDeserialize<T>(json: string): T {
  return JSON.parse(json, (_, v) =>
    typeof v === "string" && v.startsWith("BIGINT::")
      ? BigInt(v.substring(8))
      : v
  ) as T;
}

// When using google.protobuf.Value in RPC handler responses, we want to roughly match the behaviour of JSON.stringify
// for example in converting Date objects to a UTC string
export function jsonSafeAny(key: string, value: any): any {
  if (
    value !== undefined &&
    value !== null &&
    typeof value.toJSON == "function"
  ) {
    return value.toJSON(key) as any;
  } else if (globalThis.Array.isArray(value)) {
    // in place replace
    value.forEach((_, i) => (value[i] = jsonSafeAny(i.toString(), value[i])));
    return value;
  } else if (typeof value === "object") {
    Object.keys(value).forEach((key) => {
      value[key] = jsonSafeAny(key, value[key]);
    });
    return value;
  } else {
    // primitive that doesn't have a toJSON method, with no children
    return value;
  }
}

export function printMessageAsJson(obj: any): string {
  const newObj = { ...(obj as Record<string, unknown>) };
  for (const [key, value] of Object.entries(newObj)) {
    if (Buffer.isBuffer(value)) {
      newObj[key] = value.toString().trim();
    }
  }
  // Stringify object. Replace bigintToString serializer to prevent "BigInt not serializable" errors
  return JSON.stringify(obj, (_, v) =>
    typeof v === "bigint" ? v.toString() + "n" : v
  );
}

export function makeFqServiceName(pckg: string, name: string): string {
  return pckg ? `${pckg}.${name}` : name;
}

/**
 * Equality functions
 * @param msg1 the current message from user code
 * @param msg2 the replayed message
 */
// These functions are used to check whether a replayed message matches the current user code.
// We check the fields which we can check
// (the fields which do not contain results, because these might be filled in the result)

const getStateMsgEquality = (
  msg1: GetStateEntryMessage,
  msg2: GetStateEntryMessage
) => {
  return msg1.key.equals(msg2.key);
};

const invokeMsgEquality = (
  msg1: InvokeEntryMessage | BackgroundInvokeEntryMessage,
  msg2: InvokeEntryMessage | BackgroundInvokeEntryMessage
) => {
  return (
    msg1.serviceName === msg2.serviceName &&
    msg1.methodName === msg2.methodName &&
    msg1.parameter.equals(msg2.parameter)
  );
};

const setStateMsgEquality = (
  msg1: SetStateEntryMessage,
  msg2: SetStateEntryMessage
) => {
  return msg1.key.equals(msg2.key) && msg1.value.equals(msg2.value);
};

const clearStateMsgEquality = (
  msg1: ClearStateEntryMessage,
  msg2: ClearStateEntryMessage
) => {
  return msg1.key.equals(msg2.key);
};

const completeAwakeableMsgEquality = (
  msg1: CompleteAwakeableEntryMessage,
  msg2: CompleteAwakeableEntryMessage
) => {
  if (!(msg1.id === msg2.id)) {
    return false;
  }

  if (msg1.value && msg2.value) {
    return msg1.value.equals(msg2.value);
  } else if (msg1.failure && msg2.failure) {
    return (
      msg1.failure?.code === msg2.failure?.code &&
      msg1.failure?.message === msg2.failure?.message
    );
  } else {
    return false;
  }
};

const outputMsgEquality = (
  msg1: OutputStreamEntryMessage,
  msg2: OutputStreamEntryMessage
) => {
  if (msg1.value && msg2.value) {
    return msg1.value.equals(msg2.value);
  } else if (msg1.failure && msg2.failure) {
    return (
      msg1.failure?.code === msg2.failure?.code &&
      msg1.failure?.message === msg2.failure?.message
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
  [OUTPUT_STREAM_ENTRY_MESSAGE_TYPE, outputMsgEquality],
  [AWAKEABLE_ENTRY_MESSAGE_TYPE, () => true],
  [SIDE_EFFECT_ENTRY_MESSAGE_TYPE, () => true],
  [SLEEP_ENTRY_MESSAGE_TYPE, () => true],
]);
