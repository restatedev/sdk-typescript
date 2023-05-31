import * as p from "./types/protocol";
import { Journal, NewExecutionState } from "./journal";
import { RestateContextImpl } from "./restate_context_impl";
import { Connection } from "./connection/connection";
import { HostedGrpcServiceMethod } from "./types/grpc";
import { ProtocolMode } from "./generated/proto/discovery";
import { Message } from "./types/types";
import { printMessageAsJson, uuidV7FromBuffer } from "./utils/utils";
import { rlog } from "./utils/logger";
import { clearTimeout } from "timers";
import {
  OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
  OutputStreamEntryMessage,
  SUSPENSION_MESSAGE_TYPE,
  SuspensionMessage
} from "./types/protocol";
import { Failure } from "./generated/proto/protocol";

export class NewStateMachine<I, O>{
  private journal!: Journal<I, O>;
  private restateContext!: RestateContextImpl<I, O>;
  private logPrefix = "";
  private invocationIdString!: string;

  // Whether the input channel (runtime -> service) is closed
  // If it is closed, then we suspend immediately upon the next suspension point
  // If it is open, then we suspend later because we might still get completions
  private inputChannelClosed = false;

  // Suspension timeout that gets set and cleared based on completion messages;
  private suspensionTimeout?: NodeJS.Timeout;

  constructor(
    private readonly connection: Connection,
    private readonly method: HostedGrpcServiceMethod<I, O>,
    private readonly protocolMode: ProtocolMode
  ) {
    connection.onMessage(this.handleRuntimeMessage.bind(this));
    connection.onClose(this.setInputChannelToClosed.bind(this));
    connection.addOnErrorListener(() => {
      this.onError();
    });
  }

  public handleUserCodeMessage<T>(
    messageType: bigint,
    message: p.ProtocolMessage | Uint8Array,
    completedFlag?: boolean,
    protocolVersion?: number,
    requiresAckFlag?: boolean
  ): Promise<T | void>{
    /*
    Can take any type of message as input (also input stream and output stream)
    */
    rlog.debugJournalMessage(
      this.logPrefix,
      "Adding message to output buffer: type: ",
      message
    );

    const promise = this.journal.applyUserSideMessage<T>(messageType, message);

    if(this.journal.isUserSideProcessing()){
      this.connection.buffer(
        new Message(
          messageType,
          message,
          completedFlag,
          protocolVersion,
          requiresAckFlag
        )
      );
    }

    if (p.SUSPENSION_TRIGGERS.includes(messageType)) {
      this.scheduleSuspension();
    }
    return promise;
  }

  public handleRuntimeMessage(
    m: Message
  ){
    if(m.messageType === p.START_MESSAGE_TYPE){
      this.handleStartMessage(m.message as p.StartMessage);
    } else if(m.messageType === p.POLL_INPUT_STREAM_ENTRY_MESSAGE_TYPE) {
      this.handleInputMessage(m.message as p.PollInputStreamEntryMessage)
    } else {
      rlog.debugJournalMessage(this.logPrefix, "Handling message: ", m.message)
      this.journal.applyRuntimeMessage(m.messageType, m.message);
    }
  }

  handleStartMessage(m: p.StartMessage){
    this.invocationIdString = uuidV7FromBuffer(m.invocationId);
    this.logPrefix = `[${this.method.packge}.${
      this.method.service
    }-${m.instanceKey.toString("base64")}-${this.invocationIdString}] [${
      this.method.method.name
    }]`;
    rlog.debugJournalMessage(this.logPrefix, "Handling start message: ", m)

    this.restateContext = new RestateContextImpl(
      m.instanceKey,
      m.invocationId,
      this.method.service,
      this
    );
    this.journal = new Journal(this.invocationIdString, m.knownEntries, this.method);
  }

  handleInputMessage(m: p.PollInputStreamEntryMessage){
    rlog.debugJournalMessage(this.logPrefix, "Handling input message: ", m)
    this.journal.handleInputMessage(m);
    this.method.invoke(this.restateContext, m.value, this.logPrefix)
      .then((result) => {
        rlog.debugJournalMessage(
          this.logPrefix,
          "Call ended successful with message.",
          result.message
        );
        this.journal.applyUserSideMessage(result.messageType, result.message);
        this.connection.buffer(result)
      })
      .catch(async (e) => {
        if (e instanceof Error) {
          rlog.warn(`${this.logPrefix} Call failed: ${e.message} - ${e.stack}`);
        } else {
          rlog.warn(`${this.logPrefix} Call failed: ${printMessageAsJson(e)}`);
        }
        // TODO does this still need to go via the journal? I guess so?...
        this.connection.buffer(new Message(
          OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
          OutputStreamEntryMessage.create({
            failure: Failure.create({
              code: 13,
              message: `${this.logPrefix} Uncaught exception for invocation id: ${e.message}`,
            }),
          })
        ))
      })
      .finally(async ()=> {
        try {
          await this.connection.flush();
        } catch (e: any) {
          rlog.warn(`${this.logPrefix} Failed to flush output/suspension message to the runtime: ${e.message} - ${e.stack}`);
        } finally {
          // even if we failed to flush, we need to close out this state machine
          this.connection.end();
        }
      })

  }

  scheduleSuspension(){
    // If there was already a timeout set, we want to reset the time to postpone suspension as long as we make progress.
    // So we first clear the old timeout, and then we set a new one.
    if (this.suspensionTimeout) {
      clearTimeout(this.suspensionTimeout);
    }

    // Set a new suspension with a new timeout
    // The suspension will only be sent if the timeout is not canceled due to a completion.
    this.suspensionTimeout = setTimeout(() => {
      this.suspend();
    }, this.getSuspensionMillis());
  }

  // Suspension timeouts:
  // Lambda case: suspend immediately when control is back in the user code
  // Bidi streaming case:
  // - suspend after 1 seconds if input channel is still open (can still get completions)
  // - suspend immediately if input channel is closed (cannot get completions)
  getSuspensionMillis(): number {
    return this.protocolMode === ProtocolMode.REQUEST_RESPONSE
      ? 0
      : this.inputChannelClosed
        ? 0
        : 1000;
  }

  suspend(){
    rlog.debug("Suspending")

    const indices = this.journal.getCompletableIndices();
    // If the state is closed then we either already send a suspension
    // or something else bad happened...
    if (!this.journal.isInClosedState()) {
      // There need to be journal entries to complete, otherwise this timeout should have been removed.
      if (indices.length > 0) {
        // A suspension message is the end of the invocation.
        // Resolve the root call with the suspension message
        // This will lead to a onCallSuccess call where this msg will be sent.
        const msg = SuspensionMessage.create({
          entryIndexes: indices,
        });
        this.method.resolve(new Message(SUSPENSION_MESSAGE_TYPE, msg));
      } else {
        // leads to onCallFailure call
        this.method.reject(
          new Error(
            "Illegal state: Not able to send suspension message because no pending promises. " +
            "This timeout should have been removed."
          )
        );
      }
    }
    return;
  }

  setInputChannelToClosed(){
    if (!this.journal.isInClosedState()) {
      this.inputChannelClosed = true;
      // If there is a timeout planned, reset the timout to execute immediately when the work is done.
      if (this.suspensionTimeout) {
        this.scheduleSuspension();
      }
    }
  }

  onError(){
    return;
  }
}

