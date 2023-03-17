/* istanbul ignore file */
import { GreetRequest, GreetResponse } from "../src/generated/proto/example";
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
} from "../src/protocol_stream";
import { SIDE_EFFECT_ENTRY_MESSAGE_TYPE, Message } from "../src/types";

export function startMessage(knownEntries: number): Message {
  return new Message(
    START_MESSAGE_TYPE,
    StartMessage.create({
      instanceKey: Buffer.from("123"),
      invocationId: Buffer.from("abcd"),
      knownEntries: knownEntries,
      knownServiceVersion: 1,
    })
  );
}

export function inputMessage(value: Uint8Array): Message {
  return new Message(
    POLL_INPUT_STREAM_ENTRY_MESSAGE_TYPE,
    PollInputStreamEntryMessage.create({
      value: Buffer.from(value),
    })
  );
}

export function outputMessage(value: Uint8Array): Message {
  return new Message(
    OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
    OutputStreamEntryMessage.create({
      value: Buffer.from(value),
    })
  );
}

export function getStateMessage<T>(key: string, value?: T): Message {
  if (!value) {
    return new Message(
      GET_STATE_ENTRY_MESSAGE_TYPE,
      GetStateEntryMessage.create({
        key: Buffer.from(key),
      })
    );
  } else {
    return new Message(
      GET_STATE_ENTRY_MESSAGE_TYPE,
      GetStateEntryMessage.create({
        key: Buffer.from(key),
        value: Buffer.from(JSON.stringify(value)),
      })
    );
  }
}

export function setStateMessage<T>(key: string, value: T): Message {
  return new Message(
    SET_STATE_ENTRY_MESSAGE_TYPE,
    SetStateEntryMessage.create({
      key: Buffer.from(key),
      value: Buffer.from(JSON.stringify(value)),
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

export function sleepMessage(millis: number, result?: Empty): Message {
  if (result !== undefined) {
    return new Message(
      SLEEP_ENTRY_MESSAGE_TYPE,
      SleepEntryMessage.create({
        wakeUpTime: Date.now() + millis,
        result: result,
      })
    );
  } else {
    return new Message(
      SLEEP_ENTRY_MESSAGE_TYPE,
      SleepEntryMessage.create({
        wakeUpTime: Date.now() + millis,
      })
    );
  }
}

export function completionMessage(
  index: number,
  value?: any,
  empty?: boolean
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
  } else {
    return new Message(
      COMPLETION_MESSAGE_TYPE,
      CompletionMessage.create({
        entryIndex: index,
      })
    );
  }
}

export function invokeMessage(
  serviceName: string,
  methodName: string,
  parameter: Uint8Array,
  value?: Uint8Array
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
  parameter: Uint8Array
): Message {
  return new Message(
    BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE,
    BackgroundInvokeEntryMessage.create({
      serviceName: serviceName,
      methodName: methodName,
      parameter: Buffer.from(parameter),
    })
  );
}

export function sideEffectMessage<T>(value: T): Message {
  return new Message(
    SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
    Buffer.from(JSON.stringify(value))
  );
}

export function awakeableMessage<T>(payload?: T): Message {
  if (!payload) {
    return new Message(
      AWAKEABLE_ENTRY_MESSAGE_TYPE,
      AwakeableEntryMessage.create()
    );
  } else {
    return new Message(
      AWAKEABLE_ENTRY_MESSAGE_TYPE,
      AwakeableEntryMessage.create({
        value: Buffer.from(JSON.stringify(payload)),
      })
    );
  }
}

export function completeAwakeableMessage<T>(
  serviceName: string,
  instanceKey: Buffer,
  invocationId: Buffer,
  entryIndex: number,
  payload: T
): Message {
  return new Message(
    COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE,
    CompleteAwakeableEntryMessage.create({
      serviceName: serviceName,
      instanceKey: instanceKey,
      invocationId: invocationId,
      entryIndex: entryIndex,
      payload: Buffer.from(JSON.stringify(payload)),
    })
  );
}

export function greetRequest(myName: string): Uint8Array {
  return GreetRequest.encode(GreetRequest.create({ name: myName })).finish();
}

export function greetResponse(myGreeting: string): Uint8Array {
  return GreetResponse.encode(
    GreetResponse.create({ greeting: myGreeting })
  ).finish();
}
