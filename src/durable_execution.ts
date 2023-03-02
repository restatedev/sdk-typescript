/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
"use strict";

import { buffer } from "stream/consumers";
import { Connection } from "./bidirectional_server";
import { HostedGrpcServiceMethod } from "./core";
import {
  AWAKEABLE_ENTRY_MESSAGE_TYPE,
  AwakeableEntryMessage,
  BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE,
  BackgroundInvokeEntryMessage,
  CLEAR_STATE_ENTRY_MESSAGE_TYPE,
  COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE,
  COMPLETION_MESSAGE_TYPE,
  ClearStateEntryMessage,
  CompleteAwakeableEntryMessage,
  CompletionMessage,
  GET_STATE_ENTRY_MESSAGE_TYPE,
  GetStateEntryMessage,
  INVOKE_ENTRY_MESSAGE_TYPE,
  InvokeEntryMessage,
  OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
  OutputStreamEntryMessage,
  POLL_INPUT_STREAM_ENTRY_MESSAGE_TYPE,
  PollInputStreamEntryMessage,
  SET_STATE_ENTRY_MESSAGE_TYPE,
  SLEEP_ENTRY_MESSAGE_TYPE,
  START_MESSAGE_TYPE,
  SetStateEntryMessage,
  SleepEntryMessage,
  StartMessage,
} from "./protocol_stream";
import { RestateContext } from "./context";

export class DurableExecutionContext implements RestateContext {
  async getState<T>(name: string): Promise<T | null> {
    return null as T;
  }

  async setState<T>(name: string, value: T): Promise<void> {
    const str = JSON.stringify(value);
    const bytes = Buffer.from(str);
    // nothing
  }

  request(
    service: string,
    method: string,
    data: Uint8Array
  ): Promise<Uint8Array> {
    // restae call
    return Promise.resolve(new Uint8Array(0));
  }
}

enum ExecutionState {
  WAITING_FOR_START,
}

export class DurableExecutionStateMachine<I, O> {
  private state: ExecutionState = ExecutionState.WAITING_FOR_START;
  private context: DurableExecutionContext = new DurableExecutionContext();

  constructor(
    private readonly connection: Connection,
    private readonly method: HostedGrpcServiceMethod<I, O>
  ) {
    connection.onMessage(this.onIncomingMessage.bind(this));
    connection.onClose(this.onClose.bind(this));
  }

  onIncomingMessage(
    message: any,
    message_type: bigint,
    completed_flag?: boolean,
    protocol_version?: number,
    requires_ack_flag?: boolean
  ) {
    // TODO:
    // here is the hardest part.
    //
    // reminder: to send a message back to restate use: this.connection.send
    //
    // here are few examples,
    // 1. send a set access request use
    //
    // this.connection.send(GET_STATE_ENTRY_MESSAGE_TYPE, GetStateEntryMessage.create({
    //   key: Buffer.from("my-state-key-1"),
    // }));
    //
    //
    // 2. report a state access
    //
    //this.connection.send(SET_STATE_ENTRY_MESSAGE_TYPE, SetStateEntryMessage.create({
    //  key: Buffer.from("key-1"),
    //  value: Buffer.from("value-1"),
    //}));
    //
    // 3. to send a custom message (whatever that is) use
    //
    // this.connection.send(12345, Buffer.alloc(0));
    //
    // 4. to actually invoke the method with an argument.
    //
    // const result: Promise<Uint8Array> = this.method.invoke(this.context, argBytes);

    switch (message_type) {
      case START_MESSAGE_TYPE: {
        const m = message as StartMessage;
        break;
      }
      case COMPLETION_MESSAGE_TYPE: {
        const m = message as CompletionMessage;
        break;
      }
      case POLL_INPUT_STREAM_ENTRY_MESSAGE_TYPE: {
        const m = message as PollInputStreamEntryMessage;
        break;
      }
      case OUTPUT_STREAM_ENTRY_MESSAGE_TYPE: {
        const m = message as OutputStreamEntryMessage;
        break;
      }
      case GET_STATE_ENTRY_MESSAGE_TYPE: {
        const m = message as GetStateEntryMessage;
        break;
      }
      case SET_STATE_ENTRY_MESSAGE_TYPE: {
        const m = message as SetStateEntryMessage;
        break;
      }
      case CLEAR_STATE_ENTRY_MESSAGE_TYPE: {
        const m = message as ClearStateEntryMessage;
        break;
      }
      case SLEEP_ENTRY_MESSAGE_TYPE: {
        const m = message as SleepEntryMessage;
        break;
      }
      case INVOKE_ENTRY_MESSAGE_TYPE: {
        const m = message as InvokeEntryMessage;
        break;
      }
      case BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE: {
        const m = message as BackgroundInvokeEntryMessage;
        break;
      }
      case AWAKEABLE_ENTRY_MESSAGE_TYPE: {
        const m = message as AwakeableEntryMessage;
        break;
      }
      case COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE: {
        const m = message as CompleteAwakeableEntryMessage;
        break;
      }
      default: {
        // assume custom message
        break;
      }
    }
  }

  onClose() {
    // done.
    console.log(
      `DEBUG connection ${this.connection.connectionId} has been closed.`
    );
  }
}
