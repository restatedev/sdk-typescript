/*
 * Copyright (c) 2023-2024 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

/*eslint-disable @typescript-eslint/no-non-null-assertion*/

import type { Message } from "./types/types";
import type {
  InputEntryMessage,
  StartMessage,
} from "./generated/proto/protocol_pb";
import { formatMessageAsJson } from "./utils/utils";
import { INPUT_ENTRY_MESSAGE_TYPE, START_MESSAGE_TYPE } from "./types/protocol";
import type { RestateStreamConsumer } from "./connection/connection";
import { LocalStateStore } from "./local_state_store";
import { ensureError } from "./types/errors";
import { LoggerContext } from "./logger";
import { CompletablePromise } from "./utils/promises";
import type { ComponentHandler } from "./types/components";
import { Buffer } from "node:buffer";

enum State {
  ExpectingStart = 0,
  ExpectingInput = 1,
  ExpectingFurtherReplay = 2,
  Complete = 3,
}

export class InvocationBuilder implements RestateStreamConsumer {
  private readonly complete = new CompletablePromise<void>();

  private state: State = State.ExpectingStart;

  private runtimeReplayIndex = 0;
  private replayEntries = new Map<number, Message>();
  private id?: Buffer = undefined;
  private debugId?: string = undefined;
  private invocationValue?: Buffer = undefined;
  private nbEntriesToReplay?: number = undefined;
  private localStateStore?: LocalStateStore;
  private userKey?: string;
  private invocationHeaders?: ReadonlyMap<string, string>;

  constructor(private readonly component: ComponentHandler) {}

  public handleMessage(m: Message): boolean {
    try {
      switch (this.state) {
        case State.ExpectingStart:
          checkState(State.ExpectingStart, START_MESSAGE_TYPE, m);
          this.handleStartMessage(m.message as StartMessage);
          this.state = State.ExpectingInput;
          return false;

        case State.ExpectingInput:
          checkState(State.ExpectingInput, INPUT_ENTRY_MESSAGE_TYPE, m);

          this.handlePollInputStreamEntry(m);
          this.addReplayEntry(m);
          break;

        case State.ExpectingFurtherReplay:
          this.addReplayEntry(m);
          break;

        case State.Complete:
          throw new Error(
            `Journal builder is getting a message after the journal was complete. entries-to-replay: ${
              this.nbEntriesToReplay
            }, message: ${formatMessageAsJson(m)}`
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

  private handlePollInputStreamEntry(m: Message) {
    const pollInputStreamMessage = m.message as InputEntryMessage;

    this.invocationValue = Buffer.from(pollInputStreamMessage.value);
    if (pollInputStreamMessage.headers) {
      const headers: Iterable<[string, string]> =
        pollInputStreamMessage.headers.map((header) => [
          header.key,
          header.value,
        ]);
      this.invocationHeaders = new Map(headers);
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

  private handleStartMessage(m: StartMessage): InvocationBuilder {
    this.nbEntriesToReplay = m.knownEntries;
    this.id = Buffer.from(m.id);
    this.debugId = m.debugId;
    this.localStateStore = new LocalStateStore(m.partialState, m.stateMap);
    this.userKey = m.key;
    return this;
  }

  private addReplayEntry(m: Message): InvocationBuilder {
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

  public build(): Invocation {
    if (!this.isComplete()) {
      throw new Error(
        `Cannot build invocation. Not all data present: ${JSON.stringify(this)}`
      );
    }
    return new Invocation(
      this.component,
      this.id!,
      this.debugId!,
      this.nbEntriesToReplay!,
      this.replayEntries!,
      this.invocationValue!,
      this.invocationHeaders ?? new Map(),
      this.localStateStore!,
      this.userKey
    );
  }
}

export class Invocation {
  constructor(
    public readonly handler: ComponentHandler,
    public readonly id: Buffer,
    public readonly debugId: string,
    public readonly nbEntriesToReplay: number,
    public readonly replayEntries: Map<number, Message>,
    public readonly invocationValue: Buffer,
    public readonly invocationHeaders: ReadonlyMap<string, string>,
    public readonly localStateStore: LocalStateStore,
    public readonly userKey?: string
  ) {}

  public inferLoggerContext(additionalContext?: {
    [name: string]: string;
  }): LoggerContext {
    return new LoggerContext(
      this.debugId,
      "",
      this.handler.component().name(),
      this.handler.name(),
      additionalContext
    );
  }
}

function checkState(state: State, expected: bigint, m: Message) {
  if (m.messageType !== expected) {
    throw new Error(
      `Unexpected message in state ${state}: ${formatMessageAsJson(m)}`
    );
  }
}
