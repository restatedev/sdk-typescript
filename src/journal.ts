"use strict";

import * as p from "./types/protocol";
import { Failure } from "./generated/proto/protocol";
import {
  AWAKEABLE_ENTRY_MESSAGE_TYPE,
  AwakeableEntryMessage,
  BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE,
  CLEAR_STATE_ENTRY_MESSAGE_TYPE,
  COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE,
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
  SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
  SLEEP_ENTRY_MESSAGE_TYPE,
  SleepEntryMessage,
  SUSPENSION_MESSAGE_TYPE,
  SuspensionMessage,
} from "./types/protocol";
import { rlog } from "./utils/logger";
import { equalityCheckers, printMessageAsJson } from "./utils/utils";
import { Message } from "./types/types";
import { SideEffectEntryMessage } from "./generated/proto/javascript";
import { Invocation } from "./invocation";

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
      throw new Error(
        "First message of replay entries needs to be PollInputStreamMessage"
      );
    }
    this.handleInputMessage(
      inputMessage.message as PollInputStreamEntryMessage
    );
  }

  handleInputMessage(m: p.PollInputStreamEntryMessage) {
    this.transitionState(NewExecutionState.REPLAYING);

    if (this.invocation.nbEntriesToReplay === 1) {
      this.transitionState(NewExecutionState.PROCESSING);
    }

    const rootEntry = new JournalEntry(
      p.POLL_INPUT_STREAM_ENTRY_MESSAGE_TYPE,
      m
    );

    this.pendingJournalEntries.set(0, rootEntry);
  }

  public handleUserSideMessage<T>(
    messageType: bigint,
    message: p.ProtocolMessage | Uint8Array
  ): Promise<T | undefined> {
    this.incrementUserCodeIndex();

    switch (this.state) {
      case NewExecutionState.REPLAYING: {
        const replayEntry = this.invocation.replayEntries.get(
          this.userCodeJournalIndex
        );
        if (replayEntry === undefined) {
          throw new Error(
            `Illegal state: no replay message was received for the entry at journal index ${this.userCodeJournalIndex}`
          );
        }

        const journalEntry = new JournalEntry(messageType, message);
        this.handleReplay(this.userCodeJournalIndex, replayEntry, journalEntry);
        return journalEntry.promise;
      }
      case NewExecutionState.PROCESSING: {
        switch (messageType) {
          case p.SUSPENSION_MESSAGE_TYPE:
          case p.OUTPUT_STREAM_ENTRY_MESSAGE_TYPE: {
            this.handleClosingMessage(
              messageType,
              message as p.SuspensionMessage | p.OutputStreamEntryMessage
            );
            return Promise.resolve(undefined);
          }
          case p.SET_STATE_ENTRY_MESSAGE_TYPE:
          case p.CLEAR_STATE_ENTRY_MESSAGE_TYPE:
          case p.COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE:
          case p.BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE: {
            // Do not need completion
            return Promise.resolve(undefined);
          }
          default: {
            // Need completion
            const journalEntry = new JournalEntry(messageType, message);
            this.pendingJournalEntries.set(
              this.userCodeJournalIndex,
              journalEntry
            );
            return journalEntry.promise;
          }
        }
      }
      case NewExecutionState.CLOSED: {
        // We cannot do anything anymore because an output was already sent back
        // This should actually never happen because the state is only transitioned to closed if the root promise is resolved/rejected
        // So no more user messages can come in...
        // - Print warning log and continue...
        //TODO received user-side message but state machine is closed
        return Promise.resolve(undefined);
      }
      default: {
        throw new Error("Did not receive input message before other messages.");
      }
    }
  }

  public handleRuntimeCompletionMessage(m: CompletionMessage) {
    // Get message at that entryIndex in pendingJournalEntries
    const journalEntry = this.pendingJournalEntries.get(m.entryIndex);

    if (journalEntry === undefined) {
      //TODO received completion message but there is no pending promise for that index
      return;
    }

    if (m.value !== undefined) {
      journalEntry.resolve(m.value);
      this.pendingJournalEntries.delete(m.entryIndex);
    } else if (m.failure !== undefined) {
      journalEntry.reject(new Error(m.failure.message));
      this.pendingJournalEntries.delete(m.entryIndex);
    } else if (m.empty !== undefined) {
      journalEntry.resolve(m.empty);
      this.pendingJournalEntries.delete(m.entryIndex);
    } else {
      if (journalEntry.messageType === p.SIDE_EFFECT_ENTRY_MESSAGE_TYPE) {
        // Just needs and ack without completion
        journalEntry.resolve(undefined);
        this.pendingJournalEntries.delete(m.entryIndex);
      } else {
        //TODO completion message without a value/failure/empty and message is not a side effect
      }
    }
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
      throw new Error(
        `Journal mismatch: Replayed journal entries did not correspond to the user code. The user code has to be deterministic!
        The journal entry at position ${journalIndex} was:
        - In the user code: type: ${
          journalEntry.messageType
        }, message:${printMessageAsJson(journalEntry.message)}
        - In the replayed messages: type: ${
          replayMessage.messageType
        }, message: ${printMessageAsJson(replayMessage.message)}`
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
        rlog.debug(printMessageAsJson(getStateMsg));
        this.resolveResult(
          journalIndex,
          journalEntry,
          getStateMsg.value || getStateMsg.empty
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
        this.resolveResult(journalIndex, journalEntry, sleepMsg.result);
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
        rlog.debug(replayMessage.message);
        const sideEffectMsg = SideEffectEntryMessage.decode(
          replayMessage.message as Uint8Array
        );
        if (sideEffectMsg.value !== undefined) {
          this.resolveResult(
            journalIndex,
            journalEntry,
            JSON.parse(sideEffectMsg.value.toString())
          );
        } else if (sideEffectMsg.failure !== undefined) {
          this.resolveResult(
            journalIndex,
            journalEntry,
            undefined,
            sideEffectMsg.failure
          );
        } else {
          // A side effect can have a void return type
          // If it was replayed, then it is acked, so we should resolve it.
          journalEntry.resolve(undefined);
          this.pendingJournalEntries.delete(journalIndex);
        }
        break;
      }
      case SET_STATE_ENTRY_MESSAGE_TYPE:
      case CLEAR_STATE_ENTRY_MESSAGE_TYPE:
      case COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE:
      case BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE: {
        // Do not need a completion. So if the match has passed then the entry can be deleted.
        journalEntry.resolve(undefined);
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
    value?: T,
    failure?: Failure
  ) {
    if (value !== undefined) {
      journalEntry.resolve(value);
      this.pendingJournalEntries.delete(journalIndex);
    } else if (failure !== undefined) {
      journalEntry.reject(new Error(failure.message));
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
      throw new Error(
        "No root journal entry found to resolve with output stream message"
      );
    }

    this.pendingJournalEntries.delete(0);
    rootJournalEntry.resolve(new Message(messageType, message));
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
      rlog.debug("Transitioning state to " + newExecState);
      return;
    }
  }

  private incrementUserCodeIndex() {
    this.userCodeJournalIndex++;
    rlog.debug(
      "User code index incremented. New value: " + this.userCodeJournalIndex
    );

    if (
      this.userCodeJournalIndex === this.invocation.nbEntriesToReplay &&
      this.state === NewExecutionState.REPLAYING
    ) {
      this.transitionState(NewExecutionState.PROCESSING);
    }
  }

  public isClosed(): boolean {
    return this.state === NewExecutionState.CLOSED;
  }

  public isReplaying(): boolean {
    return this.state === NewExecutionState.REPLAYING;
  }

  public isProcessing(): boolean {
    return this.state === NewExecutionState.PROCESSING;
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public promise: Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public resolve!: (value: any) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public reject!: (reason?: any) => void;

  constructor(
    readonly messageType: bigint,
    readonly message: p.ProtocolMessage | Uint8Array
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.promise = new Promise<any>((res, rej) => {
      this.resolve = res;
      this.reject = rej;
    });
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
