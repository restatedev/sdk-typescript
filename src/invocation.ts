"use strict";
/*eslint-disable @typescript-eslint/no-non-null-assertion*/

import { Message } from "./types/types";
import { HostedGrpcServiceMethod } from "./types/grpc";
import {
  PollInputStreamEntryMessage,
  StartMessage,
} from "./generated/proto/protocol";
import {
  CompletablePromise,
  printMessageAsJson,
  uuidV7FromBuffer,
} from "./utils/utils";
import {
  POLL_INPUT_STREAM_ENTRY_MESSAGE_TYPE,
  START_MESSAGE_TYPE,
} from "./types/protocol";
import { RestateStreamConsumer } from "./connection/connection";
import { LocalStateStore } from "./local_state_store";
import { ensureError } from "./types/errors";

enum State {
  ExpectingStart = 0,
  ExpectingInput = 1,
  ExpectingFurtherReplay = 2,
  Complete = 3,
}

export class InvocationBuilder<I, O> implements RestateStreamConsumer {
  private readonly complete = new CompletablePromise<void>();

  private state: State = State.ExpectingStart;

  private runtimeReplayIndex = 0;
  private replayEntries = new Map<number, Message>();
  private instanceKey?: Buffer = undefined;
  private invocationId?: Buffer = undefined;
  private invocationValue?: Buffer = undefined;
  private nbEntriesToReplay?: number = undefined;
  private localStateStore?: LocalStateStore;

  constructor(private readonly method: HostedGrpcServiceMethod<I, O>) {}

  public handleMessage(m: Message): boolean {
    try {
      switch (this.state) {
        case State.ExpectingStart:
          checkState(State.ExpectingStart, START_MESSAGE_TYPE, m);
          this.handleStartMessage(
            m.message as StartMessage,
            m.partialStateFlag || false
          );
          this.state = State.ExpectingInput;
          return false;

        case State.ExpectingInput:
          checkState(
            State.ExpectingInput,
            POLL_INPUT_STREAM_ENTRY_MESSAGE_TYPE,
            m
          );
          this.addReplayEntry(m);
          break;

        case State.ExpectingFurtherReplay:
          this.addReplayEntry(m);
          break;

        case State.Complete:
          throw new Error(
            `Journal builder is getting a message after the journal was complete. entries-to-replay: ${
              this.nbEntriesToReplay
            }, message: ${printMessageAsJson(m)}`
          );
      }

      this.state =
        this.replayEntries.size === this.nbEntriesToReplay
          ? State.Complete
          : State.ExpectingFurtherReplay;

      if (this.state === State.Complete) {
        this.complete.resolve();
        return true;
      }

      return false;
    } catch (e) {
      const error = ensureError(e);
      this.complete.reject(error);
      return true; // we want no further messages
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

  private handleStartMessage(
    m: StartMessage,
    partialState: boolean
  ): InvocationBuilder<I, O> {
    this.nbEntriesToReplay = m.knownEntries;
    this.instanceKey = m.instanceKey;
    this.invocationId = m.invocationId;
    this.localStateStore = new LocalStateStore(partialState, m.stateMap);
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
  }

  public isComplete(): boolean {
    return this.state === State.Complete;
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
      this.invocationValue!,
      this.localStateStore!
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
    public readonly invocationValue: Buffer,
    public readonly localStateStore: LocalStateStore
  ) {
    this.invocationIdString = uuidV7FromBuffer(this.invocationId);
    this.logPrefix = `[${this.method.packge}.${
      this.method.service
    }-${this.instanceKey.toString("base64")}-${this.invocationIdString}] [${
      this.method.method.name
    }]`;
  }
}

function checkState(state: State, expected: bigint, m: Message) {
  if (m.messageType !== expected) {
    throw new Error(
      `Unexpected message in state ${state}: ${printMessageAsJson(m)}`
    );
  }
}
