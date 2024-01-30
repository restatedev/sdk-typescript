/*
 * Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

import * as p from "./types/protocol";
import { Failure } from "./generated/proto/protocol";
import {
  AWAKEABLE_ENTRY_MESSAGE_TYPE,
  AwakeableEntryMessage,
  BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE,
  CLEAR_STATE_ENTRY_MESSAGE_TYPE,
  COMBINATOR_ENTRY_MESSAGE,
  COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE,
  CompletionMessage,
  EntryAckMessage,
  GET_STATE_ENTRY_MESSAGE_TYPE,
  GetStateEntryMessage,
  INVOKE_ENTRY_MESSAGE_TYPE,
  InvokeEntryMessage,
  OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
  OutputStreamEntryMessage,
  POLL_INPUT_STREAM_ENTRY_MESSAGE_TYPE,
  PollInputStreamEntryMessage,
  SET_STATE_ENTRY_MESSAGE_TYPE,
  SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
  SLEEP_ENTRY_MESSAGE_TYPE,
  SleepEntryMessage,
  SUSPENSION_MESSAGE_TYPE,
  SuspensionMessage,
} from "./types/protocol";
import { equalityCheckers, jsonDeserialize } from "./utils/utils";
import { Message } from "./types/types";
import { SideEffectEntryMessage } from "./generated/proto/javascript";
import { Invocation } from "./invocation";
import { failureToError, RetryableError } from "./types/errors";
import { CompletablePromise } from "./utils/promises";

const RESOLVED = Promise.resolve(undefined);

export class Journal<I, O> {
  private state = NewExecutionState.REPLAYING;

  private userCodeJournalIndex = 0;

  // Journal entries waiting for arrival of runtime completion
  // 0 = root promise of the method invocation
  private pendingJournalEntries = new Map<number, JournalEntry>();

  constructor(readonly invocation: Invocation<I, O>) {
    const inputMessage = invocation.replayEntries.get(0);
    if (
      !inputMessage ||
      inputMessage.messageType !== POLL_INPUT_STREAM_ENTRY_MESSAGE_TYPE
    ) {
      throw RetryableError.protocolViolation(
        "First message of replay entries needs to be PollInputStreamMessage"
      );
    }
    this.handleInputMessage(
      inputMessage.message as PollInputStreamEntryMessage
    );
  }

  handleInputMessage(m: p.PollInputStreamEntryMessage) {
    if (this.invocation.nbEntriesToReplay === 1) {
      this.transitionState(NewExecutionState.PROCESSING);
    }

    const rootEntry = new JournalEntry(
      p.POLL_INPUT_STREAM_ENTRY_MESSAGE_TYPE,
      m
    );

    this.pendingJournalEntries.set(0, rootEntry);
  }

  public handleUserSideMessage(
    messageType: bigint,
    message: p.ProtocolMessage | Uint8Array
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any | undefined> {
    this.incrementUserCodeIndex();

    switch (this.state) {
      case NewExecutionState.REPLAYING: {
        const replayEntry = this.invocation.replayEntries.get(
          this.userCodeJournalIndex
        );
        if (replayEntry === undefined) {
          throw RetryableError.internal(
            `Illegal state: no replay message was received for the entry at journal index ${this.userCodeJournalIndex}`
          );
        }

        const journalEntry = new JournalEntry(messageType, message);
        this.handleReplay(this.userCodeJournalIndex, replayEntry, journalEntry);
        return journalEntry.completablePromise.promise;
      }
      case NewExecutionState.PROCESSING: {
        switch (messageType) {
          case p.SUSPENSION_MESSAGE_TYPE:
          case p.OUTPUT_STREAM_ENTRY_MESSAGE_TYPE: {
            this.handleClosingMessage(
              messageType,
              message as p.SuspensionMessage | p.OutputStreamEntryMessage
            );
            return RESOLVED;
          }
          case p.SET_STATE_ENTRY_MESSAGE_TYPE:
          case p.CLEAR_STATE_ENTRY_MESSAGE_TYPE:
          case p.COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE:
          case p.BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE: {
            // Do not need completion
            return RESOLVED;
          }
          case p.GET_STATE_ENTRY_MESSAGE_TYPE: {
            const getStateMsg = message as GetStateEntryMessage;
            if (
              getStateMsg.value !== undefined ||
              getStateMsg.empty !== undefined
            ) {
              // State was eagerly filled by the local state store
              return Promise.resolve(getStateMsg.value || getStateMsg.empty);
            } else {
              // Need to retrieve state by going to the runtime.
              return this.appendJournalEntry(messageType, message);
            }
          }
          default: {
            return this.appendJournalEntry(messageType, message);
          }
        }
      }
      case NewExecutionState.CLOSED: {
        // We cannot do anything anymore because an output was already sent back
        // This should actually never happen because the state is only transitioned to closed if the root promise is resolved/rejected
        // So no more user messages can come in...
        // - Print warning log and continue...
        //TODO received user-side message but state machine is closed
        return RESOLVED;
      }
      default: {
        throw RetryableError.protocolViolation(
          "Did not receive input message before other messages."
        );
      }
    }
  }

  public isUnResolved(index: number): boolean {
    const journalEntry = this.pendingJournalEntries.get(index);
    return journalEntry !== undefined;
  }

  public handleRuntimeCompletionMessage(m: CompletionMessage) {
    // Get message at that entryIndex in pendingJournalEntries
    const journalEntry = this.pendingJournalEntries.get(m.entryIndex);

    if (journalEntry === undefined) {
      //TODO received completion message but there is no pending promise for that index
      return;
    }

    if (m.value !== undefined) {
      journalEntry.completablePromise.resolve(m.value);
      this.pendingJournalEntries.delete(m.entryIndex);
    } else if (m.failure !== undefined) {
      // we do all completions with Terminal Errors, because failures triggered by those exceptions
      // when the bubble up would otherwise lead to re-tries, deterministic replay, re-throwing, and
      // thus an infinite loop that keeps replay-ing but never makes progress
      // these failures here consequently need to cause terminal failures, unless caught and handled
      // by the handler code
      journalEntry.completablePromise.reject(failureToError(m.failure, true));
      this.pendingJournalEntries.delete(m.entryIndex);
    } else if (m.empty !== undefined) {
      journalEntry.completablePromise.resolve(m.empty);
      this.pendingJournalEntries.delete(m.entryIndex);
    } else {
      //TODO completion message without a value/failure/empty
    }
  }

  public handleEntryAckMessage(m: EntryAckMessage) {
    // Get message at that entryIndex in pendingJournalEntries
    const journalEntry = this.pendingJournalEntries.get(m.entryIndex);

    if (journalEntry === undefined) {
      return;
    }

    // Just needs an ack
    journalEntry.completablePromise.resolve(undefined);
    this.pendingJournalEntries.delete(m.entryIndex);
  }

  private handleReplay(
    journalIndex: number,
    replayMessage: Message,
    journalEntry: JournalEntry
  ) {
    // Do the journal mismatch check
    const match = this.checkJournalMatch(
      replayMessage.messageType,
      replayMessage.message,
      journalEntry.messageType,
      journalEntry.message
    );

    // Journal mismatch check failedf
    if (!match) {
      throw RetryableError.journalMismatch(
        journalIndex,
        replayMessage,
        journalEntry
      );
    }

    // If journal mismatch check passed
    /*
    - Else if the runtime replay message contains a completion
        - If the completion is a value
            - Return the resolved user code promise with the value
        - Else if the completion is a failure
            - Return the rejected user code promise with the failure as Error
        - Else if the completion is an Empty message
            - Return the resolved user code promise with the Empty message
        - Remove the journal entry
    - Else the replayed message was uncompleted
        - Create the user code promise
        - Add message to the pendingJournalEntries
        - Return the user code promise
     */
    switch (journalEntry.messageType) {
      case SUSPENSION_MESSAGE_TYPE:
      case OUTPUT_STREAM_ENTRY_MESSAGE_TYPE: {
        this.handleClosingMessage(
          journalEntry.messageType,
          journalEntry.message as SuspensionMessage | OutputStreamEntryMessage
        );
        break;
      }
      case GET_STATE_ENTRY_MESSAGE_TYPE: {
        const getStateMsg = replayMessage.message as GetStateEntryMessage;
        this.resolveResult(
          journalIndex,
          journalEntry,
          getStateMsg.value || getStateMsg.empty,
          getStateMsg.failure
        );
        break;
      }
      case INVOKE_ENTRY_MESSAGE_TYPE: {
        const invokeMsg = replayMessage.message as InvokeEntryMessage;
        this.resolveResult(
          journalIndex,
          journalEntry,
          invokeMsg.value,
          invokeMsg.failure
        );
        break;
      }
      case SLEEP_ENTRY_MESSAGE_TYPE: {
        const sleepMsg = replayMessage.message as SleepEntryMessage;
        this.resolveResult(
          journalIndex,
          journalEntry,
          sleepMsg.empty,
          sleepMsg.failure
        );
        break;
      }
      case AWAKEABLE_ENTRY_MESSAGE_TYPE: {
        const awakeableMsg = replayMessage.message as AwakeableEntryMessage;
        this.resolveResult(
          journalIndex,
          journalEntry,
          awakeableMsg.value,
          awakeableMsg.failure
        );
        break;
      }
      case SIDE_EFFECT_ENTRY_MESSAGE_TYPE: {
        const sideEffectMsg = replayMessage.message as SideEffectEntryMessage;
        if (sideEffectMsg.value !== undefined) {
          this.resolveResult(
            journalIndex,
            journalEntry,
            jsonDeserialize(sideEffectMsg.value.toString())
          );
        } else if (sideEffectMsg.failure !== undefined) {
          this.resolveResult(
            journalIndex,
            journalEntry,
            undefined,
            sideEffectMsg.failure.failure,
            sideEffectMsg.failure.terminal
          );
        } else {
          // A side effect can have a void return type
          // If it was replayed, then it is acked, so we should resolve it.
          journalEntry.completablePromise.resolve(undefined);
          this.pendingJournalEntries.delete(journalIndex);
        }
        break;
      }
      case SET_STATE_ENTRY_MESSAGE_TYPE:
      case CLEAR_STATE_ENTRY_MESSAGE_TYPE:
      case COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE:
      case BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE:
      case COMBINATOR_ENTRY_MESSAGE: {
        // Do not need a completion. So if the match has passed then the entry can be deleted.
        journalEntry.completablePromise.resolve(undefined);
        this.pendingJournalEntries.delete(journalIndex);
        break;
      }
      default: {
        // TODO received replay message of unknown type
      }
    }
  }

  resolveResult<T>(
    journalIndex: number,
    journalEntry: JournalEntry,
    value: T | undefined,
    failure?: Failure | undefined,
    failureWouldBeTerminal?: boolean
  ) {
    if (value !== undefined) {
      journalEntry.completablePromise.resolve(value);
      this.pendingJournalEntries.delete(journalIndex);
    } else if (failure !== undefined) {
      const error = failureToError(failure, failureWouldBeTerminal ?? true);
      journalEntry.completablePromise.reject(error);
      this.pendingJournalEntries.delete(journalIndex);
    } else {
      this.pendingJournalEntries.set(journalIndex, journalEntry);
    }
  }

  handleClosingMessage(
    messageType: bigint,
    message: OutputStreamEntryMessage | SuspensionMessage
  ) {
    this.transitionState(NewExecutionState.CLOSED);
    const rootJournalEntry = this.pendingJournalEntries.get(0);

    if (rootJournalEntry === undefined) {
      // We have no other option than to throw an error here
      // Because without the root promise we cannot resolve the method or continue
      throw RetryableError.internal(
        "Illegal state: No root journal entry found to resolve with output stream message"
      );
    }

    this.pendingJournalEntries.delete(0);
    rootJournalEntry.completablePromise.resolve(
      new Message(messageType, message)
    );
  }

  private checkJournalMatch(
    runtimeMsgType: bigint,
    runtimeMsg: p.ProtocolMessage | Uint8Array,
    userCodeMsgType: bigint,
    userCodeMsg: p.ProtocolMessage | Uint8Array
  ): boolean {
    if (runtimeMsgType === userCodeMsgType) {
      const equalityFct = equalityCheckers.get(runtimeMsgType);
      if (equalityFct === undefined) {
        // TODO no equality function was defined for the message type
        return true;
      }
      return equalityFct(runtimeMsg, userCodeMsg);
    } else {
      return false;
    }
  }

  // To get the indices that need to be completed with suspension
  public getCompletableIndices(): number[] {
    // return all entries except for the root entry
    return [...this.pendingJournalEntries.entries()]
      .filter((el) => el[0] !== 0)
      .map((el) => el[0]);
  }

  private transitionState(newExecState: NewExecutionState) {
    // If the state is already closed then you cannot transition anymore
    if (
      this.state === NewExecutionState.CLOSED &&
      newExecState !== NewExecutionState.CLOSED
    ) {
      // do nothing
      return;
    } else {
      this.state = newExecState;
      return;
    }
  }

  incrementUserCodeIndex() {
    this.userCodeJournalIndex++;
    if (
      this.userCodeJournalIndex === this.invocation.nbEntriesToReplay &&
      this.state === NewExecutionState.REPLAYING
    ) {
      this.transitionState(NewExecutionState.PROCESSING);
    }
  }

  /**
   * Read the next replay entry
   */
  public readNextReplayEntry() {
    this.incrementUserCodeIndex();
    return this.invocation.replayEntries.get(this.userCodeJournalIndex);
  }

  /**
   * Append journal entry. This won't increment the journal index.
   */
  public appendJournalEntry(
    messageType: bigint,
    message: p.ProtocolMessage | Uint8Array
  ): Promise<unknown> {
    const journalEntry = new JournalEntry(messageType, message);
    this.pendingJournalEntries.set(this.userCodeJournalIndex, journalEntry);
    return journalEntry.completablePromise.promise;
  }

  public isClosed(): boolean {
    return this.state === NewExecutionState.CLOSED;
  }

  public isProcessing(): boolean {
    return this.state === NewExecutionState.PROCESSING;
  }

  public isReplaying(): boolean {
    return this.state === NewExecutionState.REPLAYING;
  }

  public getUserCodeJournalIndex(): number {
    return this.userCodeJournalIndex;
  }

  public close() {
    this.transitionState(NewExecutionState.CLOSED);
  }

  public outputMsgWasReplayed() {
    // Check if the last message of the replay entries is an output message
    const lastEntry = this.invocation.replayEntries.get(
      this.invocation.nbEntriesToReplay - 1
    );
    return (
      lastEntry && lastEntry.messageType === OUTPUT_STREAM_ENTRY_MESSAGE_TYPE
    );
  }

  // We use this for side effects.
  // The restate context needs to know if the user-defined fct needs to be executed or not.
  // It needs to know this before it can craft the message and call this.stateMachine.handleUserSideMessage(...)
  // so before the index got incremented and the state got transitioned.
  // So we cannot use isReplaying().
  // So we need to check in the journal if the next entry (= our side effect) will be replayed or not.
  nextEntryWillBeReplayed() {
    return this.userCodeJournalIndex + 1 < this.invocation.nbEntriesToReplay;
  }
}

export class JournalEntry {
  public completablePromise: CompletablePromise<unknown>;

  constructor(
    readonly messageType: bigint,
    readonly message: p.ProtocolMessage | Uint8Array
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.completablePromise = new CompletablePromise<any>();
  }
}

// "WAITING_FOR_START" before receiving start message
// "WAITING_FOR_REPLAY" when waiting for all replay entries to arrive from the runtime
// "REPLAYING" when receiving input stream message
// "PROCESSING" when both sides have finished replaying
// "CLOSED" when input stream connection channel gets closed
export enum NewExecutionState {
  REPLAYING = "REPLAYING",
  PROCESSING = "PROCESSING",
  CLOSED = "CLOSED",
}
