import { Empty } from "./generated/google/protobuf/empty";
import { StartMessage, START_MESSAGE_TYPE,
    PollInputStreamEntryMessage, POLL_INPUT_STREAM_ENTRY_MESSAGE_TYPE,
    GetStateEntryMessage, GET_STATE_ENTRY_MESSAGE_TYPE,
    SetStateEntryMessage, SET_STATE_ENTRY_MESSAGE_TYPE, CompletionMessage, COMPLETION_MESSAGE_TYPE, INVOKE_ENTRY_MESSAGE_TYPE, InvokeEntryMessage, OUTPUT_STREAM_ENTRY_MESSAGE_TYPE, OutputStreamEntryMessage, BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE, BackgroundInvokeEntryMessage
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

export function outputMessage(value: Uint8Array): any {
  return {
      message_type: OUTPUT_STREAM_ENTRY_MESSAGE_TYPE, 
      message: OutputStreamEntryMessage.create({
        value: Buffer.from(value)
      })
    };
}

export function getStateMessageCompletion<T>(key: string, value: T): any {
  return {
    message_type: GET_STATE_ENTRY_MESSAGE_TYPE, 
    message: GetStateEntryMessage.create({
      key: Buffer.from(key),
      value: Buffer.from(JSON.stringify(value))
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

export function setStateMessage<T>(key: string, value: T): any {
  return {
    message_type: SET_STATE_ENTRY_MESSAGE_TYPE, 
    message: SetStateEntryMessage.create({
      key: Buffer.from(key),
      value: Buffer.from(JSON.stringify(value))
    })
  };
}

export function completionMessage(index: number, value: any){
  return {
    message_type: COMPLETION_MESSAGE_TYPE, 
    message: CompletionMessage.create({
      entryIndex: index, 
      value: Buffer.from(value)
    })
  }
}

export function emptyCompletionMessage(index: number){
  return {
    message_type: COMPLETION_MESSAGE_TYPE, 
    message: CompletionMessage.create({
      entryIndex: index, 
      empty: Empty.create()
    })
  }
}

export function invokeMessage(serviceName: string, methodName: string, parameter: any){
  return {
    message_type: INVOKE_ENTRY_MESSAGE_TYPE, 
    message: InvokeEntryMessage.create({
      serviceName: serviceName, 
      methodName: methodName,
      parameter: Buffer.from(parameter)
    })
  }
}

export function backgroundInvokeMessage(serviceName: string, methodName: string, parameter: any){
  return {
    message_type: BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE, 
    message: BackgroundInvokeEntryMessage.create({
      serviceName: serviceName, 
      methodName: methodName,
      parameter: Buffer.from(parameter)
    })
  }
}
