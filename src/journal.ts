import * as p from "./types/protocol";
import { Failure } from "./generated/proto/protocol";
import { HostedGrpcServiceMethod } from "./types/grpc";
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

export class Journal<I, O> {
  private state = NewExecutionState.WAITING_FOR_START;

  private userCodeJournalIndex = 0;

  // Starts at 0 because we process the input entry message which will increment it to 1
  // Only used as long as the runtime input stream is in replay state
  // After that, completions can arrive in random order and contain the journal index, so necessary to keep the runtime index.
  private runtimeReplayIndex = 0;

  // Journal entries waiting for arrival of runtime completion
  // 0 = root promise of the method invocation
  private pendingJournalEntries = new Map<number, JournalEntry>();

  // Entries that were replayed by the runtime
  private replayEntries = new Map<number, Message>();

  constructor(
    readonly nbEntriesToReplay: number,
    readonly method: HostedGrpcServiceMethod<I, O>
  ) {}

  handleInputMessage(m: p.PollInputStreamEntryMessage) {
    this.transitionState(NewExecutionState.REPLAYING);

    if (this.nbEntriesToReplay === 1) {
      this.transitionState(NewExecutionState.PROCESSING);
    }

    const rootEntry = new JournalEntry(
      p.POLL_INPUT_STREAM_ENTRY_MESSAGE_TYPE,
      m
    )

    rootEntry.promise = rootEntry.promise.then(
      (result) => this.method.resolve(result),
      (failure) => this.method.resolve(failure)
    );

    this.pendingJournalEntries.set(
      0,
      rootEntry
    );
  }

  public handleUserSideMessage<T>(
    messageType: bigint,
    message: p.ProtocolMessage | Uint8Array
  ): Promise<T | undefined> {
    this.incrementUserCodeIndex();

    switch (this.state) {
      case NewExecutionState.REPLAYING: {
        const replayEntry = this.replayEntries.get(this.userCodeJournalIndex);
        if(!replayEntry){
          throw new Error(`Illegal state: no replay message was received for the entry at journal index ${this.userCodeJournalIndex}`);
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
            this.pendingJournalEntries.set(this.userCodeJournalIndex, journalEntry);
            return journalEntry.promise;
          }
        }
      }
      case NewExecutionState.CLOSED: {
        // We cannot do anything anymore because an output was already sent back
        // This should actually never happen because the state is only transitioned to closed if the root promise is resolved/rejected
        // So no more user messages can come in...
        // - Print warning log and continue...
        //TODO
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

    if(!journalEntry){
      //TODO fail
      // throw new Error("Illegal state: received a completion message but ")
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
        //TODO completion message without a value/failure/empty
      }
    }
  }

  public handleRuntimeReplayMessage(m: Message) {
    this.incrementRuntimeReplayIndex();

    // Add message to the pendingJournalEntries
    // Will be retrieved when the user code reaches this point
    this.replayEntries.set(this.runtimeReplayIndex, m);
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
      return;
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
          getStateMsg.value || getStateMsg.empty
        );
        break;
      }
      case  INVOKE_ENTRY_MESSAGE_TYPE: {
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
        } else {
          this.resolveResult(
            journalIndex,
            journalEntry,
            undefined,
            sideEffectMsg.failure
          );
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
        // TODO we shouldn't end up here... we checked all message types
      }
    }
  }

  resolveResult<T>(
    journalIndex: number,
    journalEntry: JournalEntry,
    value?: T,
    failure?: Failure
  ) {
    if (value) {
      journalEntry.resolve(value);
      this.pendingJournalEntries.delete(journalIndex);
    } else if (failure) {
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

    if(!rootJournalEntry){
      // We have no other option than to throw an error here
      // Because without the root promise we cannot resolve the method or continue
      throw new Error("No root journal entry found to resolve with output stream message")
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
      if (equalityFct) {
        return equalityFct(runtimeMsg, userCodeMsg);
      } else {
        // TODO there always has to be an equality fct defined...
        return false;
      }
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
      //TODO
      // Do not transition
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
      this.userCodeJournalIndex === this.nbEntriesToReplay &&
      this.isReplaying()
    ) {
      this.transitionState(NewExecutionState.PROCESSING);
    }
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

  public allReplayMessagesArrived(): boolean {
    return this.runtimeReplayIndex === this.nbEntriesToReplay - 1;
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

  public outputMsgWasReplayed() {
    // Check if the last message of the replay entries is an output message
    const lastEntry = this.replayEntries.get(this.nbEntriesToReplay - 1);
    return lastEntry && lastEntry.messageType === OUTPUT_STREAM_ENTRY_MESSAGE_TYPE;
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
    readonly message: p.ProtocolMessage | Uint8Array,
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
  WAITING_FOR_START = "WAITING_FOR_START",
  REPLAYING = "REPLAYING",
  PROCESSING = "PROCESSING",
  CLOSED = "CLOSED",
}
