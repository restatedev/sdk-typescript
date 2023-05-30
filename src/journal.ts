import {
  POLL_INPUT_STREAM_ENTRY_MESSAGE_TYPE,
  PollInputStreamEntryMessage,
  ProtocolMessage,
  SuspensionMessage
} from "./types/protocol";
import { Failure } from "./generated/proto/protocol";
import { HostedGrpcServiceMethod } from "./types/grpc";

export class Journal<I, O> {
  private state = NewExecutionState.WAITING_FOR_START;

  // Starts at 1 because the user code doesn't do explicit actions for the input message
  private userCodeJournalIndex = 1;

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

  public handleInputMessage(m: PollInputStreamEntryMessage, rootPromise: Promise<Uint8Array | SuspensionMessage>){
    this.pendingJournalEntries.set(0,
      new JournalEntry(POLL_INPUT_STREAM_ENTRY_MESSAGE_TYPE,
        m,
        JournalEntryStatus.WAITING_ON_COMPLETION,
        rootPromise,
        this.method.resolve,
        this.method.reject))
  }

  public applyUserSideMessage<T>(
    messageType: bigint,
    message: ProtocolMessage | Uint8Array
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
        this.handleReplay(messageType, message, journalEntry);
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
        - Else if messageType requires completion/ack
            - Add message to the pendingJournalEntries with JournalEntryStatus = WAITING_ON_COMPLETION
            - Return the user code promise;
        - Else
            - Return promise resolved with void;
       */

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

  private handleReplay(
    messageType: bigint,
    message: ProtocolMessage | Uint8Array,
    replayedMsg: JournalEntry){
    const match = this.checkJournalMatch(messageType, message, replayedMsg);
    if(match){
      /*
       - If the replayed messageType === suspension or output stream (value/failure)
          - If there are still messages with JournalEntryStatus = WAITING_ON_USER_CODE/WAITING_ON_REPLAY;
              - Resolve the root promise with output message with non-determinism failure
              (This means there were replay messages coming from the runtime that did not have a counterpart in the user code)
          - If all messages are WAITING_ON_COMPLETION;
              - Resolve the root promise with output message with suspension or response
          - Set userCodeState to CLOSED
      - Else if the replayed message contains a completion
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
    } else {
      /*
       - Resolve the root promise with output message with non-determinism failure
       - Set userCodeState to CLOSED
      */
    }
  }

  public applyRuntimeMessage(
    messageType: bigint,
    message: ProtocolMessage | Uint8Array
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
    message: ProtocolMessage | Uint8Array
  ){
    /*
    Check if the message is a completion message
    Get message at that index in pendingJournalEntries
      - If there is a pending user code message:
         - Resolve the promise with value/failure/Empty
      - Else if there is no pending user code message:
         - Resolve the promise with failure
    */
  }

  private applyRuntimeReplayMessage(
    messageType: bigint,
    message: ProtocolMessage | Uint8Array
  ){
    /*
    Increment the replay index
    Get message at runtimeReplayIndex in pendingJournalEntries
    - If there is a pending user code message:
        - Do journal mismatch check:
        - If journal mismatch check pass:
            - If the replayed messageType === suspension or output stream (value/failure)
                - If there are still messages with JournalEntryStatus = WAITING_ON_USER_CODE/WAITING_ON_REPLAY;
                      - Send back output stream message with non-determinism failure
                      (This means there were replay messages coming from the runtime that did not have a counterpart in the user code)
                - If all messages are WAITING_ON_COMPLETION;
                      - send the suspension or output stream message back
                - Set userCodeState to CLOSED
            - Else if the replayed message contains a completion -> resolve the promise and remove the journal entry
            - Else the replayed message was uncompleted -> set state to WAITING_ON_COMPLETION
        - Else journal mismatch checks fail:
            - Send back output message with non-determinism failure
            - Set userCodeState to CLOSED
    - Else there is no message (= replayed message)
        - Add message to the pendingJournalEntries with JournalEntryStatus = WAITING_ON_USER_CODE
    */
    // Increment the replay index
    this.incrementRuntimeReplayIndex();

    const journalEntry = this.pendingJournalEntries.get(this.runtimeReplayIndex);
    if(journalEntry){

    } else { // no journal entry yet
      this.pendingJournalEntries.set(this.runtimeReplayIndex,
        new JournalEntry(
          messageType,
          message,
          JournalEntryStatus.WAITING_ON_USER_CODE
        )
      )
    }
  }

  private checkJournalMatch(
    userCodeMsgType: bigint,
    userCodeMsg: ProtocolMessage | Uint8Array,
    runtimeMsg: JournalEntry): boolean {
    return true;
  }

  // To get the indices that need to be completed with suspension
  public getCompletableIndices(): number[] {
    // return all entries in WAITING_ON_COMPLETION state
    return [];
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
    else if(newExecState === NewExecutionState.PROCESSING_ON_USER_CODE_SIDE){
      if(this.state === NewExecutionState.PROCESSING_ON_RUNTIME_SIDE){
        this.state = NewExecutionState.PROCESSING
      }
    }

    // If the user side was already done with the replay,
    // and the new exec stat shows that the runtime side is also done
    // then set to "processing" because replay has ended on both sides.
    else if(newExecState === NewExecutionState.PROCESSING_ON_RUNTIME_SIDE){
      if(this.state === NewExecutionState.PROCESSING_ON_USER_CODE_SIDE){
        this.state = NewExecutionState.PROCESSING
      }
    }

    else {
      this.state = newExecState;
      return;
    }
  }

  private incrementUserCodeIndex(){
    this.userCodeJournalIndex++;

    if (
      this.userCodeJournalIndex === this.nbEntriesToReplay + 1 &&
      this.isUserSideReplaying()
    ) {
      this.transitionState(NewExecutionState.PROCESSING_ON_USER_CODE_SIDE);
    }
  }

  private incrementRuntimeReplayIndex(){
    this.runtimeReplayIndex++;

    if (
      this.runtimeReplayIndex === this.nbEntriesToReplay + 1 &&
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
}


export class JournalEntry {
  constructor(
    readonly messageType: bigint,
    readonly message: ProtocolMessage | Uint8Array,
    status: JournalEntryStatus,
    readonly promise?: Promise<any>,
    readonly resolve?: (value: any) => void,
    readonly reject?: (reason?: any) => void
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