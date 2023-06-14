"use strict";
/*eslint-disable @typescript-eslint/no-non-null-assertion*/

import { Message } from "./types/types";
import { HostedGrpcServiceMethod } from "./types/grpc";
import { rlog } from "./utils/logger";
import { PollInputStreamEntryMessage, StartMessage } from "./generated/proto/protocol";
import { uuidV7FromBuffer } from "./utils/utils";
import { POLL_INPUT_STREAM_ENTRY_MESSAGE_TYPE } from "./types/protocol";
import { ProtocolMode } from "./generated/proto/discovery";



export class InvocationBuilder<I, O> {
  private runtimeReplayIndex = 0;
  private replayEntries = new Map<number, Message>();
  private instanceKey?: Buffer = undefined;
  private invocationId?: Buffer = undefined;
  private invocationValue?: Buffer = undefined;
  private protocolMode?: ProtocolMode = undefined;
  private nbEntriesToReplay?: number = undefined;
  public method?: HostedGrpcServiceMethod<I, O> = undefined;

  public handleStartMessage(m: StartMessage): InvocationBuilder<I, O> {
    this.nbEntriesToReplay = m.knownEntries
    this.instanceKey = m.instanceKey
    this.invocationId = m.invocationId
    return this;
  }

  setProtocolMode(protocolMode: ProtocolMode): InvocationBuilder<I, O> {
    this.protocolMode = protocolMode;
    return this;
  }

  public setGrpcMethod(method: HostedGrpcServiceMethod<I, O>): InvocationBuilder<I, O> {
    this.method = method
    return this;
  }

  public addReplayEntry(m: Message): InvocationBuilder<I, O> {
    if(m.messageType === POLL_INPUT_STREAM_ENTRY_MESSAGE_TYPE){
      this.invocationValue = (m.message as PollInputStreamEntryMessage).value;
    }

    // Will be retrieved when the user code reaches this point
    this.replayEntries.set(this.runtimeReplayIndex, m);
    this.incrementRuntimeReplayIndex();
    return this;
  }

  private incrementRuntimeReplayIndex() {
    this.runtimeReplayIndex++;
    rlog.debug(
      "Runtime replay index incremented. New value: " +
      this.runtimeReplayIndex +
      " while known entries is " +
      this.nbEntriesToReplay
    );
  }

  public isComplete():boolean {
    return this.method !== undefined &&
      this.protocolMode !== undefined &&
      this.instanceKey !== undefined &&
      this.invocationId !== undefined &&
      this.nbEntriesToReplay !== undefined &&
      this.invocationValue !== undefined &&
      this.replayEntries.size === this.nbEntriesToReplay;
  }

  build(): Invocation<I, O>{
    if(!this.isComplete()){
      throw new Error(`Cannot build invocation. Not all data present: ${JSON.stringify(this)}`);
    }
    return new Invocation(
      this.method!,
      this.protocolMode!,
      this.instanceKey!,
      this.invocationId!,
      this.nbEntriesToReplay!,
      this.replayEntries!,
      this.invocationValue!
    );
  }
}

export class Invocation<I,O>{
  invocationIdString;
  logPrefix;
  constructor(
    readonly method: HostedGrpcServiceMethod<I, O>,
    readonly protocolMode: ProtocolMode,
    readonly instanceKey: Buffer,
    readonly invocationId: Buffer,
    readonly nbEntriesToReplay: number,
    readonly replayEntries: Map<number, Message>,
    readonly invocationValue: Buffer,
  ) {
    this.invocationIdString = uuidV7FromBuffer(this.invocationId);
    this.logPrefix = `[${this.method.packge}.${
      this.method.service
    }-${this.instanceKey.toString("base64")}-${this.invocationIdString}] [${
      this.method.method.name
    }]`;
  }
}