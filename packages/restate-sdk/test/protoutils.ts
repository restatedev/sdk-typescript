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

/* istanbul ignore file */
import { Empty, protoInt64 } from "@bufbuild/protobuf";
import {
  StartMessage,
  START_MESSAGE_TYPE,
  InputEntryMessage,
  INPUT_ENTRY_MESSAGE_TYPE,
  GetStateEntryMessage,
  GET_STATE_ENTRY_MESSAGE_TYPE,
  SetStateEntryMessage,
  SET_STATE_ENTRY_MESSAGE_TYPE,
  CompletionMessage,
  COMPLETION_MESSAGE_TYPE,
  INVOKE_ENTRY_MESSAGE_TYPE,
  CallEntryMessage,
  OUTPUT_ENTRY_MESSAGE_TYPE,
  OutputEntryMessage,
  BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE,
  OneWayCallEntryMessage,
  AWAKEABLE_ENTRY_MESSAGE_TYPE,
  AwakeableEntryMessage,
  COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE,
  CompleteAwakeableEntryMessage,
  CLEAR_STATE_ENTRY_MESSAGE_TYPE,
  ClearStateEntryMessage,
  SLEEP_ENTRY_MESSAGE_TYPE,
  SleepEntryMessage,
  SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
  SUSPENSION_MESSAGE_TYPE,
  SuspensionMessage,
  ERROR_MESSAGE_TYPE,
  ErrorMessage,
  ENTRY_ACK_MESSAGE_TYPE,
  EntryAckMessage,
  END_MESSAGE_TYPE,
  EndMessage,
  AWAKEABLE_IDENTIFIER_PREFIX,
  COMBINATOR_ENTRY_MESSAGE,
  CLEAR_ALL_STATE_ENTRY_MESSAGE_TYPE,
  ClearAllStateEntryMessage,
  GET_STATE_KEYS_ENTRY_MESSAGE_TYPE,
  GetStateKeysEntryMessage,
} from "../src/types/protocol";
import { Message } from "../src/types/types";
import { CombinatorEntryMessage } from "../src/generated/proto/javascript_pb";
import {
  Failure,
  RunEntryMessage,
  StartMessage_StateEntry,
} from "../src/generated/proto/protocol_pb";
import { jsonSerialize, formatMessageAsJson } from "../src/utils/utils";
import { rlog } from "../src/logger";
import {
  INTERNAL_ERROR_CODE,
  JournalErrorContext,
  RestateErrorCodes,
  UNKNOWN_ERROR_CODE,
} from "../src/types/errors";
import { expect } from "vitest";

export type StartMessageOpts = {
  knownEntries?: number;
  partialState?: boolean;
  state?: Buffer[][];
  key?: string;
};

export function startMessage({
  knownEntries,
  partialState,
  state,
  key,
}: StartMessageOpts = {}): Message {
  return new Message(
    START_MESSAGE_TYPE,
    new StartMessage({
      id: Buffer.from(
        "f311f1fdcb9863f0018bd3400ecd7d69b547204e776218b2",
        "hex"
      ),
      debugId: "8xHx_cuYY_AAYvTQA7NfWm1RyBOd2IYsg",
      knownEntries: knownEntries, // only used for the Lambda case. For bidi streaming, this will be imputed by the testdriver
      stateMap: toStateEntries(state || []),
      partialState: partialState !== false,
      key: key ?? "Till",
    }),
    undefined,
    undefined
  );
}

export function toStateEntries(entries: Buffer[][]) {
  return (
    entries.map(
      (el) => new StartMessage_StateEntry({ key: el[0], value: el[1] })
    ) || []
  );
}

export function inputMessage(value: Uint8Array): Message {
  if (value !== undefined) {
    return new Message(
      INPUT_ENTRY_MESSAGE_TYPE,
      new InputEntryMessage({
        value,
      })
    );
  } else {
    throw new Error("Input message needs either a value or a failure set.");
  }
}

export function outputMessage(value?: Uint8Array, failure?: Failure): Message {
  if (value !== undefined) {
    return new Message(
      OUTPUT_ENTRY_MESSAGE_TYPE,
      new OutputEntryMessage({
        result: { case: "value", value: Buffer.from(value) },
      })
    );
  } else if (failure !== undefined) {
    return new Message(
      OUTPUT_ENTRY_MESSAGE_TYPE,
      new OutputEntryMessage({
        result: { case: "failure", value: failure },
      })
    );
  } else {
    return new Message(
      OUTPUT_ENTRY_MESSAGE_TYPE,
      new OutputEntryMessage({
        result: {
          case: "failure",
          value: new Failure({
            code: 13,
            message: `Uncaught exception for invocation id abcd`,
          }),
        },
      })
    );
  }
}

export function getStateMessage<T>(
  key: string,
  value?: T,
  empty?: boolean,
  failure?: Failure
): Message {
  if (empty === true) {
    return new Message(
      GET_STATE_ENTRY_MESSAGE_TYPE,
      new GetStateEntryMessage({
        key: Buffer.from(key),
        result: { case: "empty", value: new Empty() },
      }),
      true
    );
  } else if (value !== undefined) {
    return new Message(
      GET_STATE_ENTRY_MESSAGE_TYPE,
      new GetStateEntryMessage({
        key: Buffer.from(key),
        result: { case: "value", value: Buffer.from(jsonSerialize(value)) },
      }),
      true
    );
  } else if (failure !== undefined) {
    return new Message(
      GET_STATE_ENTRY_MESSAGE_TYPE,
      new GetStateEntryMessage({
        key: Buffer.from(key),
        result: { case: "failure", value: failure },
      }),
      true
    );
  } else {
    return new Message(
      GET_STATE_ENTRY_MESSAGE_TYPE,
      new GetStateEntryMessage({
        key: Buffer.from(key),
      }),
      false
    );
  }
}

export function getStateMessageWithEmptyResult(key: string): Message {
  return getStateMessage(key, undefined, true);
}

export function getStateKeysMessage(value?: Array<string>): Message {
  if (value === undefined) {
    return new Message(
      GET_STATE_KEYS_ENTRY_MESSAGE_TYPE,
      new GetStateKeysEntryMessage({}),
      false
    );
  } else {
    return new Message(
      GET_STATE_KEYS_ENTRY_MESSAGE_TYPE,
      new GetStateKeysEntryMessage({
        result: {
          case: "value",
          value: { keys: value.map((b) => Buffer.from(b)) },
        },
      }),
      true
    );
  }
}

export function setStateMessage<T>(key: string, value: T): Message {
  return new Message(
    SET_STATE_ENTRY_MESSAGE_TYPE,
    new SetStateEntryMessage({
      key: Buffer.from(key),
      value: Buffer.from(jsonSerialize(value)),
    })
  );
}

export function clearStateMessage(key: string): Message {
  return new Message(
    CLEAR_STATE_ENTRY_MESSAGE_TYPE,
    new ClearStateEntryMessage({
      key: Buffer.from(key),
    })
  );
}

export function sleepMessage(
  wakeupTime: number,
  empty?: Empty,
  failure?: Failure
): Message {
  if (empty !== undefined) {
    return new Message(
      SLEEP_ENTRY_MESSAGE_TYPE,
      new SleepEntryMessage({
        wakeUpTime: protoInt64.parse(wakeupTime),
        result: { case: "empty", value: empty },
      })
    );
  } else if (failure !== undefined) {
    return new Message(
      SLEEP_ENTRY_MESSAGE_TYPE,
      new SleepEntryMessage({
        wakeUpTime: protoInt64.parse(wakeupTime),
        result: { case: "failure", value: failure },
      })
    );
  } else {
    return new Message(
      SLEEP_ENTRY_MESSAGE_TYPE,
      new SleepEntryMessage({
        wakeUpTime: protoInt64.parse(wakeupTime),
      })
    );
  }
}

export function completionMessage(
  index: number,
  /* eslint-disable @typescript-eslint/no-explicit-any */
  value?: any,
  empty?: boolean,
  failure?: Failure
): Message {
  if (value !== undefined) {
    return new Message(
      COMPLETION_MESSAGE_TYPE,
      new CompletionMessage({
        entryIndex: index,
        result: { case: "value", value: Buffer.from(value) },
      })
    );
  } else if (empty) {
    return new Message(
      COMPLETION_MESSAGE_TYPE,
      new CompletionMessage({
        entryIndex: index,
        result: { case: "empty", value: new Empty() },
      })
    );
  } else if (failure != undefined) {
    return new Message(
      COMPLETION_MESSAGE_TYPE,
      new CompletionMessage({
        entryIndex: index,
        result: { case: "failure", value: failure },
      })
    );
  } else {
    return new Message(
      COMPLETION_MESSAGE_TYPE,
      new CompletionMessage({
        entryIndex: index,
      })
    );
  }
}

export function completionMessageWithEmpty(index: number): Message {
  return new Message(
    COMPLETION_MESSAGE_TYPE,
    new CompletionMessage({
      entryIndex: index,
      result: { case: "empty", value: new Empty() },
    })
  );
}

export function ackMessage(index: number): Message {
  return new Message(
    ENTRY_ACK_MESSAGE_TYPE,
    new EntryAckMessage({
      entryIndex: index,
    })
  );
}

export function invokeMessage(
  serviceName: string,
  handlerName: string,
  parameter: Uint8Array,
  value?: Uint8Array,
  failure?: Failure,
  key?: string
): Message {
  if (value != undefined) {
    return new Message(
      INVOKE_ENTRY_MESSAGE_TYPE,
      new CallEntryMessage({
        serviceName: serviceName,
        handlerName: handlerName,
        parameter: Buffer.from(parameter),
        result: { case: "value", value: value },
        key,
      })
    );
  } else if (failure != undefined) {
    return new Message(
      INVOKE_ENTRY_MESSAGE_TYPE,
      new CallEntryMessage({
        serviceName: serviceName,
        handlerName: handlerName,
        parameter: Buffer.from(parameter),
        result: { case: "failure", value: failure },
        key,
      })
    );
  } else {
    return new Message(
      INVOKE_ENTRY_MESSAGE_TYPE,
      new CallEntryMessage({
        serviceName: serviceName,
        handlerName: handlerName,
        parameter: Buffer.from(parameter),
        key,
      })
    );
  }
}

export function backgroundInvokeMessage(
  serviceName: string,
  handlerName: string,
  parameter: Uint8Array,
  invokeTime?: number,
  key?: string
): Message {
  return invokeTime
    ? new Message(
        BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE,
        new OneWayCallEntryMessage({
          serviceName: serviceName,
          handlerName: handlerName,
          parameter: Buffer.from(parameter),
          invokeTime: protoInt64.parse(invokeTime),
          key,
        })
      )
    : new Message(
        BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE,
        new OneWayCallEntryMessage({
          serviceName: serviceName,
          handlerName: handlerName,
          parameter: Buffer.from(parameter),
        })
      );
}

export function sideEffectMessage<T>(
  value?: T,
  failure?: Failure,
  name?: string
): Message {
  if (value !== undefined) {
    return new Message(
      SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
      new RunEntryMessage({
        name,
        result: { case: "value", value: Buffer.from(JSON.stringify(value)) },
      }),
      false,
      true
    );
  } else if (failure !== undefined) {
    return new Message(
      SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
      new RunEntryMessage({
        name,
        result: { case: "failure", value: failure },
      }),
      false,
      true
    );
  } else {
    return new Message(
      SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
      new RunEntryMessage({ name }),
      false,
      true
    );
  }
}

export function awakeableMessage<T>(payload?: T, failure?: Failure): Message {
  if (payload) {
    return new Message(
      AWAKEABLE_ENTRY_MESSAGE_TYPE,
      new AwakeableEntryMessage({
        result: { case: "value", value: Buffer.from(JSON.stringify(payload)) },
      })
    );
  } else if (failure) {
    return new Message(
      AWAKEABLE_ENTRY_MESSAGE_TYPE,
      new AwakeableEntryMessage({
        result: { case: "failure", value: failure },
      })
    );
  } else {
    return new Message(
      AWAKEABLE_ENTRY_MESSAGE_TYPE,
      new AwakeableEntryMessage()
    );
  }
}

export function resolveAwakeableMessage<T>(id: string, payload: T): Message {
  return new Message(
    COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE,
    new CompleteAwakeableEntryMessage({
      id: id,
      result: { case: "value", value: Buffer.from(JSON.stringify(payload)) },
    })
  );
}

export function rejectAwakeableMessage(id: string, reason: string): Message {
  return new Message(
    COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE,
    new CompleteAwakeableEntryMessage({
      id: id,
      result: {
        case: "failure",
        value: { code: UNKNOWN_ERROR_CODE, message: reason },
      },
    })
  );
}

export function suspensionMessage(entryIndices: number[]): Message {
  return new Message(
    SUSPENSION_MESSAGE_TYPE,
    new SuspensionMessage({
      entryIndexes: entryIndices,
    })
  );
}

export function combinatorEntryMessage(
  combinatorId: number,
  journalEntriesOrder: number[]
): Message {
  return new Message(
    COMBINATOR_ENTRY_MESSAGE,
    new CombinatorEntryMessage({
      combinatorId,
      journalEntriesOrder,
    }),
    undefined,
    true
  );
}

export function failure(
  msg: string,
  code: number = INTERNAL_ERROR_CODE
): Failure {
  return new Failure({ code: code, message: msg });
}

export function greetRequest(myName: string): Uint8Array {
  const str = JSON.stringify({ name: myName });
  return Buffer.from(str);
}

export function greetResponse(myGreeting: string): Uint8Array {
  const str = JSON.stringify({ greeting: myGreeting });
  return Buffer.from(str);
}

export function errorMessage(
  failure: Failure,
  ctx?: JournalErrorContext
): Message {
  return new Message(
    ERROR_MESSAGE_TYPE,
    new ErrorMessage({
      message: failure.message,
      code: failure.code,
      relatedEntryIndex: ctx?.relatedEntryIndex,
      relatedEntryType: ctx?.relatedEntryType
        ? Number(ctx.relatedEntryType)
        : undefined,
      relatedEntryName: ctx?.relatedEntryName,
    })
  );
}

export function checkError(
  outputMsg: Message,
  errorMessage: string,
  code: number = INTERNAL_ERROR_CODE
) {
  expect(outputMsg.messageType).toEqual(ERROR_MESSAGE_TYPE);
  expect((outputMsg.message as ErrorMessage).code).toStrictEqual(code);
  expect((outputMsg.message as ErrorMessage).message).toContain(errorMessage);
}

export function checkJournalMismatchError(outputMsg: Message) {
  checkError(
    outputMsg,
    "Journal mismatch: Replayed journal entries did not correspond to the user code. The user code has to be deterministic!",
    RestateErrorCodes.JOURNAL_MISMATCH
  );
}

export function checkTerminalError(outputMsg: Message, errorMessage: string) {
  expect(outputMsg.messageType).toEqual(OUTPUT_ENTRY_MESSAGE_TYPE);

  const res = (outputMsg.message as OutputEntryMessage).result;
  expect(res.case === "failure" && res.value.message).toContain(errorMessage);
}

export function getAwakeableId(entryIndex: number): string {
  const encodedEntryIndex = Buffer.alloc(4 /* Size of u32 */);
  encodedEntryIndex.writeUInt32BE(entryIndex);

  return (
    AWAKEABLE_IDENTIFIER_PREFIX +
    Buffer.concat([
      Buffer.from("f311f1fdcb9863f0018bd3400ecd7d69b547204e776218b2", "hex"),
      encodedEntryIndex,
    ]).toString("base64url")
  );
}

export function keyVal(key: string, value: any): Buffer[] {
  return [Buffer.from(key), Buffer.from(JSON.stringify(value))];
}

export const END_MESSAGE = new Message(END_MESSAGE_TYPE, new EndMessage());
export const CLEAR_ALL_STATE_ENTRY_MESSAGE = new Message(
  CLEAR_ALL_STATE_ENTRY_MESSAGE_TYPE,
  new ClearAllStateEntryMessage()
);

// a utility function to print the results of a test
export function printResults(results: Message[]) {
  rlog.info(
    results.map(
      (el) => el.messageType + " - " + formatMessageAsJson(el.message) + "\n"
    )
  );
}
