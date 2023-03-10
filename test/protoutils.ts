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
} from "../src/protocol_stream";
import { SIDE_EFFECT_ENTRY_MESSAGE_TYPE } from "../src/types";

export function startMessage(knownEntries: number): any {
  return {
    message_type: START_MESSAGE_TYPE,
    message: StartMessage.create({
      instanceKey: Buffer.from("123"),
      invocationId: Buffer.from("abcd"),
      knownEntries: knownEntries,
      knownServiceVersion: 1,
    }),
  };
}

export function inputMessage(value: Uint8Array): any {
  return {
    message_type: POLL_INPUT_STREAM_ENTRY_MESSAGE_TYPE,
    message: PollInputStreamEntryMessage.create({
      value: Buffer.from(value),
    }),
  };
}

export function outputMessage(value: Uint8Array): any {
  return {
    message_type: OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
    message: OutputStreamEntryMessage.create({
      value: Buffer.from(value),
    }),
  };
}

export function getStateMessageCompletion<T>(key: string, value: T): any {
  return {
    message_type: GET_STATE_ENTRY_MESSAGE_TYPE,
    message: GetStateEntryMessage.create({
      key: Buffer.from(key),
      value: Buffer.from(JSON.stringify(value)),
    }),
  };
}

export function getStateMessage(key: string): any {
  return {
    message_type: GET_STATE_ENTRY_MESSAGE_TYPE,
    message: GetStateEntryMessage.create({
      key: Buffer.from(key),
    }),
  };
}

export function setStateMessage<T>(key: string, value: T): any {
  return {
    message_type: SET_STATE_ENTRY_MESSAGE_TYPE,
    message: SetStateEntryMessage.create({
      key: Buffer.from(key),
      value: Buffer.from(JSON.stringify(value)),
    }),
  };
}

export function completionMessage(index: number, value: any) {
  return {
    message_type: COMPLETION_MESSAGE_TYPE,
    message: CompletionMessage.create({
      entryIndex: index,
      value: Buffer.from(value),
    }),
  };
}

export function emptyCompletionMessage(index: number) {
  return {
    message_type: COMPLETION_MESSAGE_TYPE,
    message: CompletionMessage.create({
      entryIndex: index,
      empty: Empty.create(),
    }),
  };
}

export function invokeMessage(
  serviceName: string,
  methodName: string,
  parameter: Uint8Array
) {
  return {
    message_type: INVOKE_ENTRY_MESSAGE_TYPE,
    message: InvokeEntryMessage.create({
      serviceName: serviceName,
      methodName: methodName,
      parameter: Buffer.from(parameter),
    }),
  };
}

export function invokeMessageCompletion<T>(
  serviceName: string,
  methodName: string,
  parameter: Uint8Array,
  value: Uint8Array
) {
  return {
    message_type: INVOKE_ENTRY_MESSAGE_TYPE,
    message: InvokeEntryMessage.create({
      serviceName: serviceName,
      methodName: methodName,
      parameter: Buffer.from(parameter),
      value: Buffer.from(value),
    }),
  };
}

export function backgroundInvokeMessage(
  serviceName: string,
  methodName: string,
  parameter: Uint8Array
) {
  return {
    message_type: BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE,
    message: BackgroundInvokeEntryMessage.create({
      serviceName: serviceName,
      methodName: methodName,
      parameter: Buffer.from(parameter),
    }),
  };
}

export function sideEffectMessage<T>(value: T) {
  return {
    message_type: SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
    message: Buffer.from(JSON.stringify(value)),
  };
}

export function awakeableMessage<T>(payload: T) {
  return {
    message_type: AWAKEABLE_ENTRY_MESSAGE_TYPE,
    message: AwakeableEntryMessage.create({
      value: Buffer.from(JSON.stringify(payload)),
    }),
  };
}

export function completeAwakeableMessage<T>(
  serviceName: string,
  instanceKey: Buffer,
  invocationId: Buffer,
  entryIndex: number,
  payload: T
) {
  return {
    message_type: COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE,
    message: CompleteAwakeableEntryMessage.create({
      serviceName: serviceName,
      instanceKey: instanceKey,
      invocationId: invocationId,
      entryIndex: entryIndex,
      payload: Buffer.from(JSON.stringify(payload)),
    }),
  };
}

export function greetRequest(myName: string): Uint8Array {
  return GreetRequest.encode(GreetRequest.create({ name: myName })).finish();
}

export function greetResponse(myGreeting: string): Uint8Array {
  return GreetResponse.encode(
    GreetResponse.create({ greeting: myGreeting })
  ).finish();
}
