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
  SuspensionMessage
} from "./types/protocol";
import { rlog } from "./utils/logger";
import { equalityCheckers, printMessageAsJson } from "./utils/utils";
import { Message } from "./types/types";
import { SideEffectEntryMessage } from "./generated/proto/javascript";

export class NewJournal<I, O> {
  private state = NewExecutionState.WAITING_FOR_START;

  // Starts at 1 because the user code doesn't do explicit actions for the input message
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
    readonly invocationIdString: string,
    readonly nbEntriesToReplay: number,
    readonly method: HostedGrpcServiceMethod<I, O>
  ) {
  }

  handleInputMessage(m: p.PollInputStreamEntryMessage) {
    this.transitionState(NewExecutionState.REPLAYING);

    if (this.nbEntriesToReplay === 1) {
      this.transitionState(NewExecutionState.PROCESSING);
    }

    let resolve: (value: Message) => void;
    let reject: (reason?: any) => void;
    const promise = new Promise<Message>((res, rej) => {
      resolve = res;
      reject = rej;
    }).then(
      (result) => this.method.resolve(result),
      (failure) => this.method.resolve(failure)
    );

    this.pendingJournalEntries.set(0,
      new JournalEntry(p.POLL_INPUT_STREAM_ENTRY_MESSAGE_TYPE,
        m,
        promise,
        resolve!,
        reject!));
  }

  public applyUserSideMessage<T>(
    messageType: bigint,
    message: p.ProtocolMessage | Uint8Array
  ): Promise<T | undefined> {
    this.incrementUserCodeIndex();

    if (this.isReplaying()) {
      const replayEntry = this.replayEntries.get(this.userCodeJournalIndex);
      if (replayEntry) {
        const journalEntry = new JournalEntry(messageType, message);
        this.handleReplay(this.userCodeJournalIndex, replayEntry, journalEntry);
        return journalEntry.promise;
      } else {
        //TODO fail no replay message...
        throw new Error();
      }
    } else if (this.isProcessing()) {
      if (messageType === p.SUSPENSION_MESSAGE_TYPE ||
        messageType === p.OUTPUT_STREAM_ENTRY_MESSAGE_TYPE) {
        rlog.info("Handling output message");
        this.handleOutputMessage(messageType, message as SuspensionMessage | OutputStreamEntryMessage);
        return Promise.resolve(undefined);
      } else if (
        messageType === SET_STATE_ENTRY_MESSAGE_TYPE ||
        messageType === CLEAR_STATE_ENTRY_MESSAGE_TYPE ||
        messageType === COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE ||
        messageType === BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE
      ) {
        // Do not need completion
        return Promise.resolve(undefined);
      } else {
        // Need completion
        const journalEntry = new JournalEntry(
          messageType,
          message);
        this.pendingJournalEntries.set(this.userCodeJournalIndex, journalEntry);
        return journalEntry.promise;
      }
    } else if (this.isClosed()) {
      // We cannot do anything anymore because an output was already sent back
      // This should actually never happen because the state is only transitioned to closed if the root promise is resolved/rejected
      // So no more user messages can come in...
      // - Print warning log and continue...
      //TODO
      return Promise.resolve(undefined);
    } else {
      /*
      Output stream failure -> cannot be in this state
        - Resolve the root promise with output message with illegal state failure
       */
      //TODO
      return Promise.resolve(undefined);
    }
  }


  public applyRuntimeCompletionMessage(m: CompletionMessage) {
    // Get message at that entryIndex in pendingJournalEntries
    const journalEntry = this.pendingJournalEntries.get(m.entryIndex);
    if (journalEntry) {
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
        } else {
          //TODO completion message without a value/failure/empty
        }
      }
    } else {
      //TODO fail
    }
  }

  public applyRuntimeReplayMessage( m: Message ) {
    this.incrementRuntimeReplayIndex();

    // Add message to the pendingJournalEntries
    // Will be retrieved when the user code reaches this point
    this.replayEntries.set(this.runtimeReplayIndex, m);
  }

  // This method gets called in two cases:
  // 1. We already had a runtime replay, and now we get the user code message
  // 2. We already had the user code message, and now we get the runtime replay
  private handleReplay(
    journalIndex: number,
    replayMessage: Message,
    journalEntry: JournalEntry) {

    // Do the journal mismatch check
    const match = this.checkJournalMatch(
      replayMessage.messageType,
      replayMessage.message,
      journalEntry.messageType,
      journalEntry.message);

    // If journal mismatch check passed
    if (match) {
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
      if (journalEntry.messageType === SUSPENSION_MESSAGE_TYPE || journalEntry.messageType === OUTPUT_STREAM_ENTRY_MESSAGE_TYPE) {
        this.handleOutputMessage(journalEntry.messageType, journalEntry.message as SuspensionMessage | OutputStreamEntryMessage);
      } else if (journalEntry.messageType === GET_STATE_ENTRY_MESSAGE_TYPE) {
        const getStateMsg = replayMessage.message as GetStateEntryMessage;
        this.resolveResult(journalIndex, journalEntry, getStateMsg.value || getStateMsg.empty);
      } else if (journalEntry.messageType === INVOKE_ENTRY_MESSAGE_TYPE) {
        const invokeMsg = replayMessage.message as InvokeEntryMessage;
        this.resolveResult(journalIndex, journalEntry, invokeMsg.value, invokeMsg.failure);
      } else if (journalEntry.messageType === SLEEP_ENTRY_MESSAGE_TYPE) {
        const sleepMsg = replayMessage.message as SleepEntryMessage;
        this.resolveResult(journalIndex, journalEntry, sleepMsg.result);
      } else if (journalEntry.messageType === AWAKEABLE_ENTRY_MESSAGE_TYPE) {
        const awakeableMsg = replayMessage.message as AwakeableEntryMessage;
        this.resolveResult(journalIndex, journalEntry, awakeableMsg.value, awakeableMsg.failure);
      } else if (journalEntry.messageType === SIDE_EFFECT_ENTRY_MESSAGE_TYPE) {
        const sideEffectMsg = replayMessage.message as SideEffectEntryMessage;
        this.resolveResult(journalIndex, journalEntry, sideEffectMsg.value, sideEffectMsg.failure);
      } else if (
        journalEntry.messageType === SET_STATE_ENTRY_MESSAGE_TYPE ||
        journalEntry.messageType === CLEAR_STATE_ENTRY_MESSAGE_TYPE ||
        journalEntry.messageType === COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE ||
        journalEntry.messageType === BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE
      ) {
        // Do not need a completion. So if the match has passed then the entry can be deleted.
        journalEntry.resolve(undefined);
        this.pendingJournalEntries.delete(journalIndex);
      } else {
        // TODO we shouldn't end up here... we checked all message types
      }
    } else { // Journal mismatch check failed
      /*
       - Resolve the root promise with output message with non-determinism failure
       - Set userCodeState to CLOSED
      */
      this.resolveWithFailure(
        `Journal mismatch: Replayed journal entries did not correspond to the user code. The user code has to be deterministic!
        The journal entry at position ${journalIndex} was:
        - In the user code: type: ${ journalEntry.messageType }, message:${printMessageAsJson(journalEntry.message)}
        - In the replayed messages: type: ${replayMessage.messageType}, message: ${printMessageAsJson(replayMessage.message)}`
      )
    }
  }

  resolveResult<T>(journalIndex: number, journalEntry: JournalEntry, value?: T, failure?: Failure) {
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

  resolveWithFailure(errorMessage: string){
    const rootEntry = this.pendingJournalEntries.get(0);
    if(rootEntry){
      rootEntry.resolve(new Message(
        OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
        OutputStreamEntryMessage.create({
          failure: Failure.create({
            code: 13,
            message: `Uncaught exception for invocation id ${this.invocationIdString}: ${errorMessage}`,
          }),
        }),
        false
      ))
      this.pendingJournalEntries.delete(0);
      this.transitionState(NewExecutionState.CLOSED);
    }
  }

  handleOutputMessage(messageType: bigint, message: OutputStreamEntryMessage | SuspensionMessage) {
    const rootJournalEntry = this.pendingJournalEntries.get(0);
    if (rootJournalEntry) {
      rootJournalEntry.resolve(new Message(messageType, message));
      this.pendingJournalEntries.delete(0);
      this.transitionState(NewExecutionState.CLOSED);
    } else {
      // TODO fail if there is no rootJournalEntry
    }
    this.transitionState(NewExecutionState.CLOSED);
  }

  private checkJournalMatch(
    runtimeMsgType: bigint,
    runtimeMsg: p.ProtocolMessage | Uint8Array,
    userCodeMsgType: bigint,
    userCodeMsg: p.ProtocolMessage | Uint8Array): boolean {
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
      .filter(el => (el[0] !== 0))
      .map(el => el[0]);
  }

  private transitionState(newExecState: NewExecutionState) {

    // If the state is already closed then you cannot transition anymore
    if (this.state === NewExecutionState.CLOSED && newExecState !== NewExecutionState.CLOSED) {
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
    rlog.debug("User code index incremented. New value: " + this.userCodeJournalIndex);

    if (
      this.userCodeJournalIndex === this.nbEntriesToReplay &&
      this.isReplaying()
    ) {
      this.transitionState(NewExecutionState.PROCESSING);
    }
  }

  private incrementRuntimeReplayIndex() {
    this.runtimeReplayIndex++;
    rlog.debug("Runtime replay index incremented. New value: " + this.runtimeReplayIndex + " while known entries is " + this.nbEntriesToReplay);
  }

  public allReplayMessagesArrived(): boolean {
    return this.runtimeReplayIndex === this.nbEntriesToReplay - 1
  }

  public isClosed(): boolean {
    return this.state === NewExecutionState.CLOSED;
  }

  public isWaitingForStart(): boolean {
    return this.state === NewExecutionState.WAITING_FOR_START;
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
}


export class JournalEntry {
  public promise: Promise<any>
  public resolve!: (value: any) => void
  public reject!: (reason?: any) => void

  constructor(
    readonly messageType: bigint,
    readonly message: p.ProtocolMessage | Uint8Array,
    private customPromise?: Promise<any>,
    private customResolve?: (value: any) => void,
    private customReject?: (reason?: any) => void
  ) {
    // Either use the custom promise that is provided or make a new promise
    if(customPromise && customResolve && customReject) {
      this.promise = customPromise
      this.resolve = customResolve;
      this.reject = customReject;
    } else {
      this.promise = new Promise<any>((res, rej) => {
        this.resolve = res;
        this.reject = rej;
      });
    }
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