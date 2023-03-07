import { StartMessage, START_MESSAGE_TYPE,
    PollInputStreamEntryMessage, POLL_INPUT_STREAM_ENTRY_MESSAGE_TYPE,
    GetStateEntryMessage, GET_STATE_ENTRY_MESSAGE_TYPE,
    SetStateEntryMessage, SET_STATE_ENTRY_MESSAGE_TYPE, CompletionMessage, COMPLETION_MESSAGE_TYPE
  } from "./protocol_stream";


export function startMessage(knownEntries: number): any {
  return {
      message_type: START_MESSAGE_TYPE, 
      message: StartMessage.create({ invocationId: Buffer.from("abcd"), knownEntries: knownEntries})
      };
}

export function inputMessage(value: Uint8Array): any {
  return {
      message_type: POLL_INPUT_STREAM_ENTRY_MESSAGE_TYPE, 
      message: PollInputStreamEntryMessage.create({
        value: Buffer.from(value)
      })
    };
}

export function getStateMessageCompletion(key: string, value: string): any {
  return {
    message_type: GET_STATE_ENTRY_MESSAGE_TYPE, 
    message: GetStateEntryMessage.create({
      key: Buffer.from(key),
      value: Buffer.from(value)
    })
  };
}

export function getStateMessage(key: string): any {
  return {
    message_type: GET_STATE_ENTRY_MESSAGE_TYPE, 
    message: GetStateEntryMessage.create({
      key: Buffer.from(key)
    })
  };
}

export function setStateMessage(key: string, value: string): any {
  return {
    message_type: SET_STATE_ENTRY_MESSAGE_TYPE, 
    message: SetStateEntryMessage.create({
      key: Buffer.from(key),
      value: Buffer.from(value)
    })
  };
}

export function completionMessage(index: number, value: string){
  return {
    message_type: COMPLETION_MESSAGE_TYPE, 
    message: CompletionMessage.create({
      entryIndex: index, 
      value: Buffer.from(value)
    })
  }
}