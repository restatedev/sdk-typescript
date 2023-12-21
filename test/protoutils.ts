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

/* istanbul ignore file */
import { Empty } from "../src/generated/google/protobuf/empty";
import {
  StartMessage,
  START_MESSAGE_TYPE,
  PollInputStreamEntryMessage,
  POLL_INPUT_STREAM_ENTRY_MESSAGE_TYPE,
  GetStateEntryMessage,
  GET_STATE_ENTRY_MESSAGE_TYPE,
  SetStateEntryMessage,
  SET_STATE_ENTRY_MESSAGE_TYPE,
  CompletionMessage,
  COMPLETION_MESSAGE_TYPE,
  INVOKE_ENTRY_MESSAGE_TYPE,
  InvokeEntryMessage,
  OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
  OutputStreamEntryMessage,
  BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE,
  BackgroundInvokeEntryMessage,
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
} from "../src/types/protocol";
import { Message } from "../src/types/types";
import { TestRequest, TestResponse } from "../src/generated/proto/test";
import {
  FailureWithTerminal,
  SideEffectEntryMessage,
} from "../src/generated/proto/javascript";
import {
  Failure,
  StartMessage_StateEntry,
} from "../src/generated/proto/protocol";
import { expect } from "@jest/globals";
import {
  CompletablePromise,
  jsonSerialize,
  printMessageAsJson,
} from "../src/utils/utils";
import { rlog } from "../src/utils/logger";
import { ErrorCodes, RestateErrorCodes } from "../src/types/errors";

export function startMessage(
  knownEntries?: number,
  partialState?: boolean,
  state?: Buffer[][]
): Message {
  return new Message(
    START_MESSAGE_TYPE,
    StartMessage.create({
      id: Buffer.from(
        "f311f1fdcb9863f0018bd3400ecd7d69b547204e776218b2",
        "hex"
      ),
      debugId: "8xHx_cuYY_AAYvTQA7NfWm1RyBOd2IYsg",
      knownEntries: knownEntries, // only used for the Lambda case. For bidi streaming, this will be imputed by the testdriver
      stateMap: toStateEntries(state || []),
      partialState: partialState !== false,
    }),
    undefined,
    0,
    undefined
  );
}

export function toStateEntries(entries: Buffer[][]) {
  return (
    entries.map((el) =>
      StartMessage_StateEntry.create({ key: el[0], value: el[1] })
    ) || []
  );
}

export function inputMessage(value?: Uint8Array, failure?: Failure): Message {
  if (failure !== undefined) {
    return new Message(
      POLL_INPUT_STREAM_ENTRY_MESSAGE_TYPE,
      PollInputStreamEntryMessage.create({
        failure: failure,
      })
    );
  } else if (value !== undefined) {
    return new Message(
      POLL_INPUT_STREAM_ENTRY_MESSAGE_TYPE,
      PollInputStreamEntryMessage.create({
        value: Buffer.from(value),
      })
    );
  } else {
    throw new Error("Input message needs either a value or a failure set.");
  }
}

export function outputMessage(value?: Uint8Array, failure?: Failure): Message {
  if (value !== undefined) {
    return new Message(
      OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
      OutputStreamEntryMessage.create({
        value: Buffer.from(value),
      })
    );
  } else if (failure !== undefined) {
    return new Message(
      OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
      OutputStreamEntryMessage.create({
        failure: failure,
      })
    );
  } else {
    return new Message(
      OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
      OutputStreamEntryMessage.create({
        failure: Failure.create({
          code: 13,
          message: `Uncaught exception for invocation id abcd`,
        }),
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
      GetStateEntryMessage.create({
        key: Buffer.from(key),
        empty: Empty.create({}),
      })
    );
  } else if (value !== undefined) {
    return new Message(
      GET_STATE_ENTRY_MESSAGE_TYPE,
      GetStateEntryMessage.create({
        key: Buffer.from(key),
        value: Buffer.from(jsonSerialize(value)),
      })
    );
  } else if (failure !== undefined) {
    return new Message(
      GET_STATE_ENTRY_MESSAGE_TYPE,
      GetStateEntryMessage.create({
        key: Buffer.from(key),
        failure: failure,
      })
    );
  } else {
    return new Message(
      GET_STATE_ENTRY_MESSAGE_TYPE,
      GetStateEntryMessage.create({
        key: Buffer.from(key),
      })
    );
  }
}

export function setStateMessage<T>(key: string, value: T): Message {
  return new Message(
    SET_STATE_ENTRY_MESSAGE_TYPE,
    SetStateEntryMessage.create({
      key: Buffer.from(key),
      value: Buffer.from(jsonSerialize(value)),
    })
  );
}

export function clearStateMessage(key: string): Message {
  return new Message(
    CLEAR_STATE_ENTRY_MESSAGE_TYPE,
    ClearStateEntryMessage.create({
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
      SleepEntryMessage.create({
        wakeUpTime: wakeupTime,
        empty: empty,
      })
    );
  } else if (failure !== undefined) {
    return new Message(
      SLEEP_ENTRY_MESSAGE_TYPE,
      SleepEntryMessage.create({
        wakeUpTime: wakeupTime,
        failure: failure,
      })
    );
  } else {
    return new Message(
      SLEEP_ENTRY_MESSAGE_TYPE,
      SleepEntryMessage.create({
        wakeUpTime: wakeupTime,
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
      CompletionMessage.create({
        entryIndex: index,
        value: Buffer.from(value),
      })
    );
  } else if (empty) {
    return new Message(
      COMPLETION_MESSAGE_TYPE,
      CompletionMessage.create({
        entryIndex: index,
        empty: Empty.create(),
      })
    );
  } else if (failure != undefined) {
    return new Message(
      COMPLETION_MESSAGE_TYPE,
      CompletionMessage.create({
        entryIndex: index,
        failure: failure,
      })
    );
  } else {
    return new Message(
      COMPLETION_MESSAGE_TYPE,
      CompletionMessage.create({
        entryIndex: index,
      })
    );
  }
}

export function ackMessage(index: number): Message {
  return new Message(
    ENTRY_ACK_MESSAGE_TYPE,
    EntryAckMessage.create({
      entryIndex: index,
    })
  );
}

export function invokeMessage(
  serviceName: string,
  methodName: string,
  parameter: Uint8Array,
  value?: Uint8Array,
  failure?: Failure
): Message {
  if (value != undefined) {
    return new Message(
      INVOKE_ENTRY_MESSAGE_TYPE,
      InvokeEntryMessage.create({
        serviceName: serviceName,
        methodName: methodName,
        parameter: Buffer.from(parameter),
        value: Buffer.from(value),
      })
    );
  } else if (failure != undefined) {
    return new Message(
      INVOKE_ENTRY_MESSAGE_TYPE,
      InvokeEntryMessage.create({
        serviceName: serviceName,
        methodName: methodName,
        parameter: Buffer.from(parameter),
        failure: failure,
      })
    );
  } else {
    return new Message(
      INVOKE_ENTRY_MESSAGE_TYPE,
      InvokeEntryMessage.create({
        serviceName: serviceName,
        methodName: methodName,
        parameter: Buffer.from(parameter),
      })
    );
  }
}

export function backgroundInvokeMessage(
  serviceName: string,
  methodName: string,
  parameter: Uint8Array,
  invokeTime?: number
): Message {
  return invokeTime
    ? new Message(
        BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE,
        BackgroundInvokeEntryMessage.create({
          serviceName: serviceName,
          methodName: methodName,
          parameter: Buffer.from(parameter),
          invokeTime: invokeTime,
        })
      )
    : new Message(
        BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE,
        BackgroundInvokeEntryMessage.create({
          serviceName: serviceName,
          methodName: methodName,
          parameter: Buffer.from(parameter),
        })
      );
}

export function sideEffectMessage<T>(
  value?: T,
  failure?: FailureWithTerminal
): Message {
  if (value !== undefined) {
    return new Message(
      SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
      SideEffectEntryMessage.create({
        value: Buffer.from(JSON.stringify(value)),
      }),
      false,
      undefined,
      true
    );
  } else if (failure !== undefined) {
    return new Message(
      SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
      SideEffectEntryMessage.create({ failure: failure }),
      false,
      undefined,
      true
    );
  } else {
    return new Message(
      SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
      SideEffectEntryMessage.create({}),
      false,
      undefined,
      true
    );
  }
}

export function awakeableMessage<T>(payload?: T, failure?: Failure): Message {
  if (payload) {
    return new Message(
      AWAKEABLE_ENTRY_MESSAGE_TYPE,
      AwakeableEntryMessage.create({
        value: Buffer.from(JSON.stringify(payload)),
      })
    );
  } else if (failure) {
    return new Message(
      AWAKEABLE_ENTRY_MESSAGE_TYPE,
      AwakeableEntryMessage.create({
        failure: failure,
      })
    );
  } else {
    return new Message(
      AWAKEABLE_ENTRY_MESSAGE_TYPE,
      AwakeableEntryMessage.create()
    );
  }
}

export function resolveAwakeableMessage<T>(id: string, payload: T): Message {
  return new Message(
    COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE,
    CompleteAwakeableEntryMessage.create({
      id: id,
      value: Buffer.from(JSON.stringify(payload)),
    })
  );
}

export function rejectAwakeableMessage(id: string, reason: string): Message {
  return new Message(
    COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE,
    CompleteAwakeableEntryMessage.create({
      id: id,
      failure: { code: ErrorCodes.UNKNOWN, message: reason },
    })
  );
}

export function suspensionMessage(entryIndices: number[]): Message {
  return new Message(
    SUSPENSION_MESSAGE_TYPE,
    SuspensionMessage.create({
      entryIndexes: entryIndices,
    })
  );
}

export function failure(
  msg: string,
  code: number = ErrorCodes.INTERNAL
): Failure {
  return Failure.create({ code: code, message: msg });
}

export function failureWithTerminal(
  terminal: boolean,
  msg: string,
  code: number = ErrorCodes.INTERNAL
): FailureWithTerminal {
  return FailureWithTerminal.create({
    terminal,
    failure: Failure.create({ code: code, message: msg }),
  });
}

export function greetRequest(myName: string): Uint8Array {
  return TestRequest.encode(TestRequest.create({ name: myName })).finish();
}

export function greetResponse(myGreeting?: string): Uint8Array {
  return TestResponse.encode(
    TestResponse.create({ greeting: myGreeting })
  ).finish();
}

export function checkError(
  outputMsg: Message,
  errorMessage: string,
  code: number = ErrorCodes.INTERNAL
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
  expect(outputMsg.messageType).toEqual(OUTPUT_STREAM_ENTRY_MESSAGE_TYPE);
  expect(
    (outputMsg.message as OutputStreamEntryMessage).failure?.message
  ).toContain(errorMessage);
}

export function getAwakeableId(entryIndex: number): string {
  const encodedEntryIndex = Buffer.alloc(4 /* Size of u32 */);
  encodedEntryIndex.writeUInt32BE(entryIndex);

  return Buffer.concat([
    Buffer.from("f311f1fdcb9863f0018bd3400ecd7d69b547204e776218b2", "hex"),
    encodedEntryIndex,
  ]).toString("base64url");
}

export function keyVal(key: string, value: any): Buffer[] {
  return [Buffer.from(key), Buffer.from(JSON.stringify(value))];
}

export const END_MESSAGE = new Message(END_MESSAGE_TYPE, EndMessage.create());

// a utility function to print the results of a test
export function printResults(results: Message[]) {
  rlog.info(
    results.map(
      (el) => el.messageType + " - " + printMessageAsJson(el.message) + "\n"
    )
  );
}

export class Latch<T> {
  completablePromise: CompletablePromise<T>;

  constructor() {
    this.completablePromise = new CompletablePromise<T>();
  }

  resolveNow(value: T) {
    this.completablePromise.resolve(value);
  }

  resolveAtNextTick(value: T) {
    setImmediate(() => this.completablePromise.resolve(value));
  }

  async await(): Promise<T> {
    return this.completablePromise.promise;
  }
}
