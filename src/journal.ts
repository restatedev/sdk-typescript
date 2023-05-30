import * as p from "./types/protocol";
import { Failure } from "./generated/proto/protocol";
import { HostedGrpcServiceMethod } from "./types/grpc";
import {
  BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE,
  CLEAR_STATE_ENTRY_MESSAGE_TYPE, COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE,
  GET_STATE_ENTRY_MESSAGE_TYPE, GetStateEntryMessage,
  OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
  OutputStreamEntryMessage, SET_STATE_ENTRY_MESSAGE_TYPE,
  SUSPENSION_MESSAGE_TYPE,
  SuspensionMessage
} from "./types/protocol";
import { rlog } from "./utils/logger";

export class Journal<I, O> {
  private state = NewExecutionState.WAITING_FOR_START;

  // Starts at 1 because the user code doesn't do explicit actions for the input message
  private userCodeJournalIndex = 0;

  // Starts at 0 because we process the input entry message which will increment it to 1
  // Only used as long as the runtime input stream is in replay state
  // After that, completions can arrive in random order and contain the journal index, so necessary to keep the runtime index.
  private runtimeReplayIndex = 0;

  // Journal entries waiting for arrival of user code message or runtime replay/completion
  // 0 = root promise of the method invocation in state WAITING_ON_COMPLETION
  private pendingJournalEntries = new Map<number, JournalEntry>();

  constructor(
    readonly nbEntriesToReplay: number,
    readonly method: HostedGrpcServiceMethod<I, O>
  ) {
  }

  handleInputMessage(m: p.PollInputStreamEntryMessage){
    this.transitionState(NewExecutionState.REPLAYING);

    if(this.nbEntriesToReplay === 1){
      this.transitionState(NewExecutionState.PROCESSING_ON_RUNTIME_SIDE)
    }

    let resolve: (value: SuspensionMessage | Uint8Array) => void;
    let reject: (reason?: any) => void;
    const promise = new Promise<SuspensionMessage | Uint8Array>((res, rej) => {
      resolve = res;
      reject = rej;
    }).then(
      (result) => this.method.resolve(result),
      (failure) => this.method.resolve(failure)
    );

    this.pendingJournalEntries.set(0,
      new JournalEntry(p.POLL_INPUT_STREAM_ENTRY_MESSAGE_TYPE,
        m,
        JournalEntryStatus.WAITING_ON_COMPLETION,
        promise,
        resolve!,
        reject!));
  }

  public applyUserSideMessage<T>(
    messageType: bigint,
    message: p.ProtocolMessage | Uint8Array
  ): Promise<T> {
    this.incrementUserCodeIndex();

    let resolve: (value: any) => void;
    let reject: (reason?: any) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    if(this.isUserSideReplaying()){
      const journalEntry = this.pendingJournalEntries.get(this.userCodeJournalIndex);
      if(journalEntry){
        if(journalEntry.status === JournalEntryStatus.WAITING_ON_USER_CODE){
          this.handleReplay(this.userCodeJournalIndex, messageType, journalEntry.message, message, journalEntry);
        } else {
          //TODO duplicate user side message for journal index
        }
      } else { // no replayed message yet
        /*
          - Add message to the pendingJournalEntries with JournalEntryStatus = WAITING_ON_REPLAY
          - Return the user code promise
         */
        this.pendingJournalEntries.set(this.userCodeJournalIndex,
          new JournalEntry(
            messageType,
            message,
            JournalEntryStatus.WAITING_ON_REPLAY,
            promise,
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            resolve!,
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            reject!));
        return promise;
      }

    } else if (this.isUserSideProcessing()){
      /*
        - If messageType === suspension or output stream (value/failure)
            - If there are still messages with JournalEntryStatus = WAITING_ON_USER_CODE/WAITING_ON_REPLAY;
                - Send back output stream message with non-determinism failure
                (This means there were replay messages coming from the runtime that did not have a counterpart in the user code)
            - If all messages are WAITING_ON_COMPLETION;
                - send the suspension or output stream message back
            - Set userCodeState to CLOSED
        - Else if messageType does not require completion/ack
            - Return promise resolved with void;
        - Else
            - Add message to the pendingJournalEntries with JournalEntryStatus = WAITING_ON_COMPLETION
            - Return the user code promise;
       */
      if(messageType === p.SUSPENSION_MESSAGE_TYPE ||
        messageType === p.OUTPUT_STREAM_ENTRY_MESSAGE_TYPE){
        rlog.info("Handling output message")
        this.handleOutputMessage(messageType, message as SuspensionMessage | OutputStreamEntryMessage);
        return promise; // TODO??
      } else if(
        messageType === SET_STATE_ENTRY_MESSAGE_TYPE ||
        messageType === CLEAR_STATE_ENTRY_MESSAGE_TYPE ||
        messageType === COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE ||
        messageType === BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE
      ) {
        // Do not need completion

      } else {
        // Need completion
        this.pendingJournalEntries.set(this.userCodeJournalIndex,
          new JournalEntry(
            messageType,
            message,
            JournalEntryStatus.WAITING_ON_COMPLETION,
            promise,
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            resolve!,
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            reject!));
        return promise;
      }

    } else if(this.isInClosedState()){
      // We cannot do anything anymore because an output was already sent back
      // This should actually never happen because the state is only transitioned to closed if the root promise is resolved/rejected
      // So no more user messages can come in...
      // - Print warning log and continue...
    } else {
      /*
      Output stream failure -> cannot be in this state
        - Resolve the root promise with output message with illegal state failure
       */
    }
    return promise;
  }

  public applyRuntimeMessage(
    messageType: bigint,
    message: p.ProtocolMessage | Uint8Array
  ) {
    // can take any type of message

    // First do the status check for the runtimeInputStreamState
    if(this.state === NewExecutionState.WAITING_FOR_START ||
      this.state === NewExecutionState.REPLAYING){
      this.applyRuntimeReplayMessage(messageType, message);
    } else if (this.state === NewExecutionState.PROCESSING) {
      this.applyRuntimeCompletionMessage(messageType, message);
    } else if(this.state === NewExecutionState.CLOSED){
      // Ignoring the message
      // Could be a promise that wasn't awaited on (e.g. invoke)
      // or a replay or completion that arrived after sending back a failure or suspending
      return;
    } else {
      // WAITING_FOR_START
      // Resolve method with failure -> did not receive start message as first message
      return;
    }
  }

  private applyRuntimeCompletionMessage(
    messageType: bigint,
    message: p.ProtocolMessage | Uint8Array
  ){
    // Check if the message is a completion message
    if(messageType === p.COMPLETION_MESSAGE_TYPE){
      const complMsg = message as p.CompletionMessage;
      // Get message at that entryIndex in pendingJournalEntries
      const journalEntry = this.pendingJournalEntries.get(complMsg.entryIndex)
      if(journalEntry){
        if(complMsg.value !== undefined){
          journalEntry.resolve(complMsg.value);
          this.pendingJournalEntries.delete(complMsg.entryIndex);
        } else if (complMsg.failure !== undefined) {
          journalEntry.reject(new Error(complMsg.failure.message));
          this.pendingJournalEntries.delete(complMsg.entryIndex);
        } else if (complMsg.empty !== undefined) {
          journalEntry.resolve(complMsg.empty);
          this.pendingJournalEntries.delete(complMsg.entryIndex);
        } else {
          if(journalEntry.messageType === p.SIDE_EFFECT_ENTRY_MESSAGE_TYPE){
            // Just needs and ack without completion
            journalEntry.resolve(undefined);
          } else {
            //TODO completion message without a value/failure/empty
          }
        }
      } else {
        //TODO fail
      }
    } else {
      //TODO fail
    }
  }

  private applyRuntimeReplayMessage(
    messageType: bigint,
    message: p.ProtocolMessage | Uint8Array
  ){
    this.incrementRuntimeReplayIndex();

    const journalEntry = this.pendingJournalEntries.get(this.runtimeReplayIndex);
    if(journalEntry){
      if(journalEntry.status === JournalEntryStatus.WAITING_ON_REPLAY){
        this.handleReplay(this.runtimeReplayIndex, messageType, message, journalEntry.message, journalEntry)
      } else {
        // TODO duplicate replay message received from the runtime ...
      }
    } else {
      // No journal entry found.
      // Add message to the pendingJournalEntries with JournalEntryStatus = WAITING_ON_USER_CODE
      // Will be completed when the user code reaches this point
      let resolve: (value: any) => void;
      let reject: (reason?: any) => void;
      const promise = new Promise<any>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      this.pendingJournalEntries.set(this.runtimeReplayIndex,
        new JournalEntry(
          messageType,
          message,
          JournalEntryStatus.WAITING_ON_USER_CODE,
          promise,
          resolve!,
          reject!
        )
      )
    }
  }

  // This method gets called in two cases:
  // 1. We already had a runtime replay, and now we get the user code message
  // 2. We already had the user code message, and now we get the runtime replay
  private handleReplay(
    journalIndex: number,
    messageType: bigint,
    runtimeMsg: p.ProtocolMessage | Uint8Array,
    userCodeMessage: p.ProtocolMessage | Uint8Array,
    journalEntry: JournalEntry){

    // Do the journal mismatch check
    const match = this.checkJournalMatch(messageType, runtimeMsg, userCodeMessage);

    // If journal mismatch check passed
    if(match){
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
          - Add message to the pendingJournalEntries with JournalEntryStatus = WAITING_ON_COMPLETION
          - Return the user code promise
       */
      if(messageType === SUSPENSION_MESSAGE_TYPE || messageType === OUTPUT_STREAM_ENTRY_MESSAGE_TYPE){
        this.handleOutputMessage(messageType, userCodeMessage as SuspensionMessage | OutputStreamEntryMessage)
      } else if (messageType === GET_STATE_ENTRY_MESSAGE_TYPE) {
        rlog.debug("Handling get state")
        const getStateMsg = runtimeMsg as GetStateEntryMessage;
        if (getStateMsg.value || getStateMsg.empty) {
          journalEntry.resolve(getStateMsg.value || getStateMsg.empty)
        }
      } else {
        /*
        - Else the replayed message was uncompleted
          - Create the user code promise
          - Add message to the pendingJournalEntries with JournalEntryStatus = WAITING_ON_COMPLETION
          - Return the user code promise
         */
        journalEntry.status = JournalEntryStatus.WAITING_ON_COMPLETION;
        this.pendingJournalEntries.set(journalIndex, journalEntry);
      }
    } else { // Journal mismatch check failed
      /*
       - Resolve the root promise with output message with non-determinism failure
       - Set userCodeState to CLOSED
      */
    }
  }

  handleOutputMessage(messageType: bigint, message: OutputStreamEntryMessage | SuspensionMessage){
    if(this.allMsgsWereReplayed()){
      // If all messages are WAITING_ON_COMPLETION;
      // - send the suspension or output stream message back
      const rootJournalEntry = this.pendingJournalEntries.get(0);
      if(rootJournalEntry){
        rootJournalEntry.resolve(message); // TODO fail if there is no rootJournalEntry
      }
    } else {
      // If there are still messages with JournalEntryStatus = WAITING_ON_USER_CODE/WAITING_ON_REPLAY;
      // - Send back output stream message with non-determinism failure
      // (This means there were replay messages coming from the runtime that did not have a counterpart in the user code)
      // TODO fail with non-determinism
    }
    this.transitionState(NewExecutionState.CLOSED);
  }

  private checkJournalMatch(
    userCodeMsgType: bigint,
    runtimeMsg: p.ProtocolMessage | Uint8Array,
    userCodeMsg: p.ProtocolMessage | Uint8Array): boolean {
    return true;
  }

  // To get the indices that need to be completed with suspension
  public getCompletableIndices(): number[] {
    // return all entries in WAITING_ON_COMPLETION state
    return [...this.pendingJournalEntries.entries()]
      .filter(el =>
        // All entries in state WAITING_ON_COMPLETION, except for the root promise (index 0)
        (el[0] !== 0) && (el[1].status === JournalEntryStatus.WAITING_ON_COMPLETION))
      .map(el => el[0]);
  }

  private transitionState(newExecState: NewExecutionState){

    // If the state is already closed then you cannot transition anymore
    if(this.state === NewExecutionState.CLOSED){
      if(newExecState !== NewExecutionState.CLOSED){
        //TODO
      }
    }

    // If the runtime side was already done with the replay,
    // and the new exec stat shows that the user side is also done
    // then set to "processing" because replay has ended on both sides.
    else if(newExecState === NewExecutionState.PROCESSING_ON_USER_CODE_SIDE &&
      this.state === NewExecutionState.PROCESSING_ON_RUNTIME_SIDE){
        rlog.debug("Transitioning state to PROCESSING")
        this.state = NewExecutionState.PROCESSING
    }

    // If the user side was already done with the replay,
    // and the new exec stat shows that the runtime side is also done
    // then set to "processing" because replay has ended on both sides.
    else if(newExecState === NewExecutionState.PROCESSING_ON_RUNTIME_SIDE &&
      this.state === NewExecutionState.PROCESSING_ON_USER_CODE_SIDE){
        rlog.debug("Transitioning state to PROCESSING")
        this.state = NewExecutionState.PROCESSING
    }

    else {
      this.state = newExecState;
      rlog.debug("Transitioning state to " + newExecState)
      return;
    }
  }

  private incrementUserCodeIndex(){
    this.userCodeJournalIndex++;

    if (
      this.userCodeJournalIndex === this.nbEntriesToReplay &&
      this.isUserSideReplaying()
    ) {
      this.transitionState(NewExecutionState.PROCESSING_ON_USER_CODE_SIDE);
    }
  }

  private incrementRuntimeReplayIndex(){
    this.runtimeReplayIndex++;

    if (
      this.runtimeReplayIndex === this.nbEntriesToReplay &&
      this.isRuntimeSideReplaying()
    ) {
      this.transitionState(NewExecutionState.PROCESSING_ON_RUNTIME_SIDE);
    }
  }

  public isInClosedState(): boolean{
    return this.state === NewExecutionState.CLOSED;
  }

  private isUserSideReplaying():boolean {
    return this.state === NewExecutionState.REPLAYING ||
      this.state === NewExecutionState.PROCESSING_ON_RUNTIME_SIDE;
  }

  public isUserSideProcessing(): boolean {
    return this.state === NewExecutionState.PROCESSING ||
      this.state === NewExecutionState.PROCESSING_ON_USER_CODE_SIDE;
  }

  private isRuntimeSideReplaying(){
    return this.state === NewExecutionState.REPLAYING ||
      this.state === NewExecutionState.PROCESSING_ON_USER_CODE_SIDE;
  }

  private isRuntimeSideProcessing(): boolean {
    return this.state === NewExecutionState.PROCESSING ||
      this.state === NewExecutionState.PROCESSING_ON_RUNTIME_SIDE;
  }

  private allMsgsWereReplayed(): boolean {
    const msgsToBeReplayed = [...this.pendingJournalEntries.entries()]
      .filter(el => (el[1].status !== JournalEntryStatus.WAITING_ON_COMPLETION))
    return msgsToBeReplayed.length === 0
  }
}


export class JournalEntry {
  constructor(
    readonly messageType: bigint,
    readonly message: p.ProtocolMessage | Uint8Array,
    public status: JournalEntryStatus,
    readonly promise: Promise<any>,
    readonly resolve: (value: any) => void,
    readonly reject: (reason?: any) => void
  ) {
  }


}

// Used to know if a journal entry has been checked
enum JournalEntryStatus {
  WAITING_ON_REPLAY, // entry that has been created based on user code message and is waiting for runtime replay
  WAITING_ON_USER_CODE, // entry that has been created by a runtime replay and is waiting for user code progress
  WAITING_ON_COMPLETION// entry waiting for runtime completion (if this is a replayed entry than this means it passed the journal mismatch checks)
  //COMPLETED -> not necessary because a message will be removed when it is completed
}

// "WAITING_FOR_START" before receiving start message
// "REPLAYING" when receiving input stream message
// "REPLAYING_USER_CODE" when runtimeReplayIndex === nbEntriesToReplay
// "REPLAYING_RUNTIME" when userCodeJournalIndex === nbEntriesToReplay
// "PROCESSING" when both sides have finished replaying
// "CLOSED" when input stream connection channel gets closed
export enum NewExecutionState {
  WAITING_FOR_START = "WAITING_FOR_START",
  REPLAYING = "REPLAYING",
  PROCESSING_ON_RUNTIME_SIDE = "PROCESSING_ON_RUNTIME_SIDE",
  PROCESSING_ON_USER_CODE_SIDE = "PROCESSING_ON_USER_CODE_SIDE",
  PROCESSING = "PROCESSING",
  CLOSED = "CLOSED",
}