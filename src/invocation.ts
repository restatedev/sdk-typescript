"use strict";
/*eslint-disable @typescript-eslint/no-non-null-assertion*/

import { Message } from "./types/types";
import { HostedGrpcServiceMethod } from "./types/grpc";
import { rlog } from "./utils/logger";
import {
  PollInputStreamEntryMessage,
  StartMessage,
} from "./generated/proto/protocol";
import { CompletablePromise, uuidV7FromBuffer } from "./utils/utils";
import {
  POLL_INPUT_STREAM_ENTRY_MESSAGE_TYPE,
  START_MESSAGE_TYPE,
} from "./types/protocol";
import { RestateStreamConsumer } from "./connection/connection";

export class InvocationBuilder<I, O> implements RestateStreamConsumer {
  private readonly complete = new CompletablePromise<void>();

  private runtimeReplayIndex = 0;
  private replayEntries = new Map<number, Message>();
  private instanceKey?: Buffer = undefined;
  private invocationId?: Buffer = undefined;
  private invocationValue?: Buffer = undefined;
  private nbEntriesToReplay?: number = undefined;

  constructor(private readonly method: HostedGrpcServiceMethod<I, O>) {}

  public handleMessage(m: Message): boolean {
    if (m.messageType === START_MESSAGE_TYPE) {
      this.handleStartMessage(m.message as StartMessage);
      return false;
    } else {
      this.addReplayEntry(m);
      const isComplete = this.isComplete();
      if (isComplete) {
        this.complete.resolve();
      }
      return isComplete;
    }
  }

  public handleStreamError(e: Error): void {
    this.complete.reject(e);
  }
  public handleInputClosed(): void {
    this.complete.reject(new Error("Input closed before journal is complete"));
  }

  public completion(): Promise<void> {
    return this.complete.promise;
  }

  private handleStartMessage(m: StartMessage): InvocationBuilder<I, O> {
    this.nbEntriesToReplay = m.knownEntries;
    this.instanceKey = m.instanceKey;
    this.invocationId = m.invocationId;
    return this;
  }

  private addReplayEntry(m: Message): InvocationBuilder<I, O> {
    if (m.messageType === POLL_INPUT_STREAM_ENTRY_MESSAGE_TYPE) {
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

  public isComplete(): boolean {
    return (
      this.instanceKey !== undefined &&
      this.invocationId !== undefined &&
      this.nbEntriesToReplay !== undefined &&
      this.invocationValue !== undefined &&
      this.replayEntries.size === this.nbEntriesToReplay
    );
  }

  public build(): Invocation<I, O> {
    if (!this.isComplete()) {
      throw new Error(
        `Cannot build invocation. Not all data present: ${JSON.stringify(this)}`
      );
    }
    return new Invocation(
      this.method!,
      this.instanceKey!,
      this.invocationId!,
      this.nbEntriesToReplay!,
      this.replayEntries!,
      this.invocationValue!
    );
  }
}

export class Invocation<I, O> {
  public readonly invocationIdString;
  public readonly logPrefix;
  constructor(
    public readonly method: HostedGrpcServiceMethod<I, O>,
    public readonly instanceKey: Buffer,
    public readonly invocationId: Buffer,
    public readonly nbEntriesToReplay: number,
    public readonly replayEntries: Map<number, Message>,
    public readonly invocationValue: Buffer
  ) {
    this.invocationIdString = uuidV7FromBuffer(this.invocationId);
    this.logPrefix = `[${this.method.packge}.${
      this.method.service
    }-${this.instanceKey.toString("base64")}-${this.invocationIdString}] [${
      this.method.method.name
    }]`;
  }
}
