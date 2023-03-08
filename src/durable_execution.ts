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

  // Number of journal entries that will be replayed by the runtime
  private nbEntriesToReplay!: number;
  // Increments for each replay message we get from the runtime. 
  // We need this to match incoming replayed messages with the promises they need to resolve (can be out of sync).  
  private replayIndex = 0; 

  private currentJournalIndex = 0;

  // This flag is set to true when an inter-service request is done that needs to happen in the background.
  // Both types of requests (background or sync) call the same request() method. 
  // So to be able to know if a request is a background request or not, the user first sets this flag:
  // e.g.: ctx.inBackground(() => client.greet(request))
  private inBackgroundFlag = false;

  // Promises that need to be resolved. Journal index -> promise
  private pendingPromises: Map<number, (value: any) => void>;

  constructor(
    private readonly connection: Connection,
    private readonly method: HostedGrpcServiceMethod<I, O>
  ) {
    connection.onMessage(this.onIncomingMessage.bind(this));
    connection.onClose(this.onClose.bind(this));
    this.pendingPromises = new Map();
  }

  async getState<T>(name: string): Promise<T | null> {
    console.debug("Service called getState: " + name);

    return new Promise<Buffer>((resolve, reject) => {
      this.incrementJournalIndex();
      this.pendingPromises.set(this.currentJournalIndex, resolve);
      
      if(this.state === ExecutionState.PROCESSING){
        console.debug("Forward the GetStateEntryMessage to the runtime")
        // Forward to runtime
        this.connection.send(GET_STATE_ENTRY_MESSAGE_TYPE, GetStateEntryMessage.create({key: Buffer.from(name)}));
      } else{
        console.debug("In replay mode: GetState message will not be forwarded to the runtime. This will be fulfilled by the next replayed journal entry.")
      }
    }).then<T>((result: Buffer) => {return JSON.parse(result.toString()) as T} )
    .catch<null>(() => {return null});
  }

  async setState<T>(name: string, value: T): Promise<void> {
    console.debug("Service called setState: " + name);
    const str = JSON.stringify(value);
    const bytes = Buffer.from(str);
    this.incrementJournalIndex();

    if(this.state === ExecutionState.PROCESSING){
      console.debug("Forward the SetStateEntryMessage to the runtime")
      // Forward to runtime
      this.connection.send(SET_STATE_ENTRY_MESSAGE_TYPE, SetStateEntryMessage.create({key: Buffer.from(name, 'utf8'), value: bytes}));
    } else{
      console.debug("In replay mode: SetState message will not be forwarded to the runtime. This will be fulfilled by the next replayed journal entry.")
    }
  }

  async clearState<T>(name: string): Promise<void> {
    console.debug("Service called clearState: " + name);
    this.incrementJournalIndex();

    if(this.state === ExecutionState.PROCESSING){
      console.debug("Forward the ClearStateEntryMessage to the runtime")
      // Forward to runtime
      this.connection.send(CLEAR_STATE_ENTRY_MESSAGE_TYPE, ClearStateEntryMessage.create({key: Buffer.from(name, 'utf8')}));
    } else{
      console.debug("In replay mode: ClearState message will not be forwarded to the runtime. This will be fulfilled by the next replayed journal entry.")
    }
  }

  request(
    service: string,
    method: string,
    data: Uint8Array
  ): Promise<Uint8Array> {
    console.debug(`Service called other service: ${service} / ${method}`);
    this.incrementJournalIndex();

    return new Promise((resolve, reject) => {
      this.pendingPromises.set(this.currentJournalIndex, resolve);
      
      if(this.state === ExecutionState.PROCESSING){
        // Forward to runtime
        if(this.inBackgroundFlag){
          console.debug("Forward the BackgroundInvokeEntryMessage to the runtime")
          this.connection.send(BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE, BackgroundInvokeEntryMessage.create(
            {serviceName: service, methodName: method, parameter: Buffer.from(data)}));
        } else {
          console.debug("Forward the InvokeEntryMessage to the runtime")
          this.connection.send(INVOKE_ENTRY_MESSAGE_TYPE, InvokeEntryMessage.create(
            {serviceName: service, methodName: method, parameter: Buffer.from(data)}));
        }
      } else{
        console.debug("Ignoring call request from user. We are in replay mode. This will be fulfilled by the next journal entry.")
      }
    });
  }

  async inBackground<T>(call: () => Promise<T>): Promise<void>  {
    this.inBackgroundFlag = true;
    call();
    this.inBackgroundFlag = false;
  }

  // Called for every incoming message from the runtime.
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


    switch (message_type) {
      case START_MESSAGE_TYPE: {
        const m = message as StartMessage;
        console.debug("Received start message: " + JSON.stringify(m));

        this.nbEntriesToReplay = m.knownEntries;

        this.transitionState(ExecutionState.REPLAYING);
        if (this.nbEntriesToReplay === 0) {
          console.debug("No entries to replay so switching to PROCESSING state")
          this.transitionState(ExecutionState.PROCESSING);
        }

        break;
      }
      case COMPLETION_MESSAGE_TYPE: {
        const m = message as CompletionMessage;
        console.debug("Received completion message: " + JSON.stringify(m));

        this.resolvePromise(m.entryIndex, m.value);
        break;
      }
      case POLL_INPUT_STREAM_ENTRY_MESSAGE_TYPE: {
        const m = message as PollInputStreamEntryMessage;
        console.debug("Received input message: " + JSON.stringify(m));
      
        this.method.invoke(this, m.value)
          .then(
              (value) => this.onCallSuccess(value), 
              // (failure) => this.onCallFailure(failure)
            );
        
        break;
      }
      case GET_STATE_ENTRY_MESSAGE_TYPE: {
        const m = message as GetStateEntryMessage;
        console.debug("Received completed GetStateEntryMessage from runtime: " + JSON.stringify(m));

        if(this.state === ExecutionState.REPLAYING) {
          this.replayIndex++
          if(m.value != undefined){
            console.debug("Resolving state to " + m.value.toString())
            this.resolvePromise(this.currentJournalIndex, m.value as Buffer);   
          } else {
            console.debug("Empty value");
            this.resolvePromise(this.currentJournalIndex, null); 
          }
        } else { 
          throw new Error("Illegal state: We received a GetStateEntryMessage from the runtime but we are not in replay mode.")
        }
        break;
      }
      case SET_STATE_ENTRY_MESSAGE_TYPE: {
        const m = message as SetStateEntryMessage;
        console.debug("Received SetStateEntryMessage: " + JSON.stringify(m));
        
        if(this.state === ExecutionState.REPLAYING){
          this.replayIndex++
        } else {
          throw new Error("Illegal state: We received a SetStateEntryMessage from the runtime but we are not in replay mode.")
        }
        break;
      }
      case CLEAR_STATE_ENTRY_MESSAGE_TYPE: {
        const m = message as ClearStateEntryMessage;
        console.debug("Received ClearStateEntryMessage: " + JSON.stringify(m));

        if(this.state === ExecutionState.REPLAYING){
          this.replayIndex++
        } else{
          throw new Error("Illegal state: We received a ClearStateEntryMessage from the runtime but we are not in replay mode.")
        }
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

        if(this.state === ExecutionState.REPLAYING) {
          this.replayIndex++
          if(m.value != undefined){
            console.debug("Resolving state to " + m.value.toString())
            this.resolvePromise(this.replayIndex, m.value as Buffer);   
          } else {
            console.debug("Empty value");
            this.resolvePromise(this.replayIndex, null); 
          }
        } else { 
          throw new Error("Illegal state: We received a InvokeEntryMessage from the runtime but we are not in replay mode.")
        }
        break;
      }
      case BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE: {
        const m = message as BackgroundInvokeEntryMessage;
        console.debug("Received BackgroundInvokeEntryMessage: " + JSON.stringify(m));

        if(this.state === ExecutionState.REPLAYING){
          this.replayIndex++
        } else {
          throw new Error("Illegal state: We received a ClearStateEntryMessage from the runtime but we are not in replay mode.")
        }
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
    console.debug(`Incremented journal index. Journal index is now  ${this.currentJournalIndex} while known_entries is ${this.nbEntriesToReplay}` );

    if(this.currentJournalIndex === this.nbEntriesToReplay && this.state === ExecutionState.REPLAYING){
      this.transitionState(ExecutionState.PROCESSING);
    }
  }

  resolvePromise<T>(journalIndex: number, value: T){
    const resolveFct = this.pendingPromises.get(journalIndex);
    if(!resolveFct){
      throw new Error(`Promise for journal index ${journalIndex} not found`);
    }
    console.debug("Resolving the promise of journal entry " + journalIndex);
    resolveFct(value);
    this.pendingPromises.delete(journalIndex);
  }

  onCallSuccess(result: Uint8Array){
    console.debug("Call successfully completed")
    this.connection.send(OUTPUT_STREAM_ENTRY_MESSAGE_TYPE, OutputStreamEntryMessage.create({value: Buffer.from(result)}));
    this.connection.end();
  }

  onCallFailure(failure: any){
    console.debug("Call failed: " + failure)
    // TODO parse error codes and messages
    this.connection.send(OUTPUT_STREAM_ENTRY_MESSAGE_TYPE, OutputStreamEntryMessage.create({failure: {code: 1, message: "Call failed"}}));
    this.connection.end();
  }

  onClose() {
    // done.
    console.log(
      `DEBUG connection ${this.connection} has been closed.`
    );
  }
}