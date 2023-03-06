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
import { stat } from "fs";
import { resolve } from "path";

enum ExecutionState {
  WAITING_FOR_START = "WAITING_FOR_START",
  REPLAYING = "REPLAYING",
  PROCESSING = "PROCESSING",
  CLOSED = "CLOSED",
}

export class DurableExecutionStateMachine<I, O>  implements RestateContext {

  private state: ExecutionState = ExecutionState.WAITING_FOR_START;

  private entriesToReplay!: number;

  private currentJournalIndex: number = 0;

  // Promises that need to be resolved. Journal index -> promise
  private pendingPromises: Map<number, (value: any) => void>;

  // // history to be replayed at initiation
  private history: Array<any>;

  constructor(
    private readonly connection: Connection,
    private readonly method: HostedGrpcServiceMethod<I, O>
  ) {
    connection.onMessage(this.onIncomingMessage.bind(this));
    connection.onClose(this.onClose.bind(this));
    this.pendingPromises = new Map();
    this.history = new Array<number>();
  }


  async getState<T>(name: string): Promise<T | null> {
    console.debug("Service called getState: " + name);
    this.currentJournalIndex++;

    return new Promise((resolve, reject) => {
      this.pendingPromises.set(this.currentJournalIndex, resolve);
      
      if(this.state === ExecutionState.PROCESSING){
        console.debug("Forward the GetStateEntryMessage to the runtime")
        // Forward to runtime
        this.connection.send(GET_STATE_ENTRY_MESSAGE_TYPE, GetStateEntryMessage.create({key: Buffer.from(name)}));
      } else{
        console.log("Ignoring get state entry message from user. We are in replay mode. This will be fulfilled by the next journal entry.")
      }
    });
  }

  async setState<T>(name: string, value: T): Promise<void> {
    console.debug("Service called setState: " + name);
    const str = JSON.stringify(value);
    const bytes = Buffer.from(str);

    SetStateEntryMessage.create({key: Buffer.from(name, 'utf8'), value: bytes});
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


  onIncomingMessage(
    message_type: bigint,
    message: any,
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
    // 1. send a state access request use
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

    // if(this.state == ExecutionState.REPLAYING && this.history.length < this.entriesToReplay){
    //   // First save all the messages which are replayed. Because we need all the completions before we can continue.
    //   console.log("Save as history: " + message);
    //   this.history.push({message_type: message_type, message: message});
    // } else if(this.state == ExecutionState.REPLAYING && this.history.length === this.entriesToReplay){
    //   // play history
    //   console.log("Replay history");

      

    //   // process the new message
    //   this.handleMessage(message_type, message);

    // } else{
    //   this.handleMessage(message_type, message);
    // }

    this.handleMessage(message_type, message);
  }

  handleMessage(
    message_type: bigint,
    message: any,
    completed_flag?: boolean,
    protocol_version?: number,
    requires_ack_flag?: boolean
  ) {
    switch (message_type) {
      case START_MESSAGE_TYPE: {
        const m = message as StartMessage;
        console.debug("Received start message: " + JSON.stringify(m));

        this.entriesToReplay = m.knownEntries;

        this.transitionState(ExecutionState.REPLAYING);
        if (this.entriesToReplay === 0) {
          console.debug("No entries to replay so switching to PROCESSING state")
          this.transitionState(ExecutionState.PROCESSING);
        }

        break;
      }
      case COMPLETION_MESSAGE_TYPE: {
        const m = message as CompletionMessage;
        console.debug("Received completion message: " + JSON.stringify(m));
        
        break;
      }
      case POLL_INPUT_STREAM_ENTRY_MESSAGE_TYPE: {
        const m = message as PollInputStreamEntryMessage;
        console.debug("Received input message: " + JSON.stringify(m));

        this.incrementJournalIndex();
      
        this.method.invoke(this, m.value)
          .then(
              (value) => this.onCallSuccess(value), 
              (failure) => this.onCallFailure(failure)
            );
        
        break;
      }
      case GET_STATE_ENTRY_MESSAGE_TYPE: {
        const m = message as GetStateEntryMessage;
        console.debug("Received completed GetStateEntryMessage from runtime: " + JSON.stringify(m));

        if(this.state === ExecutionState.REPLAYING) {

          const resolveFct = this.pendingPromises.get(this.currentJournalIndex);
          if(!resolveFct){
            throw new Error(`Promise for journal index ${this.currentJournalIndex} not found`);
          }
          resolveFct(m.value);
          this.pendingPromises.delete(this.currentJournalIndex);
          
        }
        break;
      }
      case SET_STATE_ENTRY_MESSAGE_TYPE: {
        const m = message as SetStateEntryMessage;
        console.debug("Received SetStateEntryMessage: " + JSON.stringify(m));

        break;
      }
      case CLEAR_STATE_ENTRY_MESSAGE_TYPE: {
        const m = message as ClearStateEntryMessage;
        console.debug("Received ClearStateEntryMessage: " + JSON.stringify(m));

        break;
      }
      case SLEEP_ENTRY_MESSAGE_TYPE: {
        const m = message as SleepEntryMessage;
        console.debug("Received SleepEntryMessage: " + JSON.stringify(m));
        break;
      }
      case INVOKE_ENTRY_MESSAGE_TYPE: {
        const m = message as InvokeEntryMessage;
        console.debug("Received InvokeEntryMessage: " + JSON.stringify(m));
        break;
      }
      case BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE: {
        const m = message as BackgroundInvokeEntryMessage;
        console.debug("Received BackgroundInvokeEntryMessage: " + JSON.stringify(m));
        break;
      }
      case AWAKEABLE_ENTRY_MESSAGE_TYPE: {
        const m = message as AwakeableEntryMessage;
        console.debug("Received AwakeableEntryMessage: " + JSON.stringify(m));
        break;
      }
      case COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE: {
        const m = message as CompleteAwakeableEntryMessage;
        console.debug("Received CompleteAwakeableEntryMessage: " + JSON.stringify(m));
        break;
      }
      default: {
        // assume custom message
        break;
      }
    }
  }

  transitionState(newExecState: ExecutionState): void {
    if(this.state === ExecutionState.CLOSED){
        // Cannot move out of closed state
        return;
    }
    console.debug(`Transitioning invocation state machine from ${this.state} to ${newExecState}`);

    this.state = newExecState;
  }

  incrementJournalIndex(): void {
      this.currentJournalIndex++;

      if(this.currentJournalIndex >= this.entriesToReplay && this.state == ExecutionState.REPLAYING){
        this.transitionState(ExecutionState.PROCESSING);
      }
  }

  onCallSuccess(result: Uint8Array){
    console.debug("Call successfully completed")
    this.connection.send(OUTPUT_STREAM_ENTRY_MESSAGE_TYPE, OutputStreamEntryMessage.create({value: Buffer.from(result)}), true);
    this.connection.end();
  }

  onCallFailure(failure: any){
    console.debug("Call failed")
    // TODO parse error codes and messages
    this.connection.send(OUTPUT_STREAM_ENTRY_MESSAGE_TYPE, OutputStreamEntryMessage.create({failure: {code: 1, message: "Call failed"}}), true);
    this.connection.end();
  }

  onClose() {
    // done.
    console.log(
      `DEBUG connection ${this.connection} has been closed.`
    );
  }
}