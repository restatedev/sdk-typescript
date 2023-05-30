import * as p from "./types/protocol";
import { Journal } from "./journal";
import { RestateContextImpl } from "./restate_context_impl";
import { Connection } from "./connection/connection";
import { HostedGrpcServiceMethod } from "./types/grpc";
import { ProtocolMode } from "./generated/proto/discovery";
import { Message } from "./types/types";
import { printMessageAsJson, uuidV7FromBuffer } from "./utils/utils";
import { rlog } from "./utils/logger";
import { clearTimeout } from "timers";
import { OUTPUT_STREAM_ENTRY_MESSAGE_TYPE, OutputStreamEntryMessage, SUSPENSION_MESSAGE_TYPE } from "./types/protocol";
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
    connection.onMessage(this.applyRuntimeMessage.bind(this));
    connection.onClose(this.setInputChannelToClosed.bind(this));
    connection.addOnErrorListener(() => {
      this.onError();
    });
  }

  public applyUserCodeMessage<T>(
    messageType: bigint,
    message: p.ProtocolMessage | Uint8Array,
    completedFlag?: boolean,
    protocolVersion?: number,
    requiresAckFlag?: boolean
  ): Promise<T>{
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

  public applyRuntimeMessage(
    m: Message
  ){
    if(m.messageType === p.START_MESSAGE_TYPE){
      this.handleStartMessage(m.message as p.StartMessage);
    } if(m.messageType === p.POLL_INPUT_STREAM_ENTRY_MESSAGE_TYPE) {
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
    this.journal = new Journal(m.knownEntries, this.method);
  }

  async handleInputMessage(m: p.PollInputStreamEntryMessage){
    rlog.debugJournalMessage(this.logPrefix, "Handling input message: ", m)
    const rootPromise = this.method.invoke(this.restateContext, m.value, this.logPrefix)
    rootPromise
      .then((result) => {
        if (result instanceof Uint8Array) {
          const msg = OutputStreamEntryMessage.create({
            value: Buffer.from(result),
          });
          rlog.debugJournalMessage(
            this.logPrefix,
            "Call ended successful with output message.",
            msg
          );
          this.connection.buffer(
            new Message(OUTPUT_STREAM_ENTRY_MESSAGE_TYPE, msg)
          );
        } else {
          rlog.debugJournalMessage(this.logPrefix, "Call suspending. ", result);
          this.connection.buffer(
            new Message(
              SUSPENSION_MESSAGE_TYPE,
              result,
              undefined,
              undefined,
              undefined
            )
          );
        }
      })
      .catch((e) => {
        if (e instanceof Error) {
          rlog.warn(`${this.logPrefix} Call failed: ${e.message} - ${e.stack}`);
        } else {
          rlog.warn(`${this.logPrefix} Call failed: ${printMessageAsJson(e)}`);
        }

        // We send the message straight over the connection
        this.connection.buffer(
          new Message(
            OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
            OutputStreamEntryMessage.create({
              failure: Failure.create({
                code: 13,
                message: `Uncaught exception for invocation id ${this.invocationIdString}: ${e.message}`,
              }),
            })
          )
        );
      })
      .finally( async () => {
        try {
          await this.connection.flush();
        } catch (e: any) {
          rlog.warn(`${this.logPrefix} Failed to flush output/suspension message to the runtime: ${e.message} - ${e.stack}`);
        } finally {
          this.connection.end();
        }
      });
    this.journal.handleInputMessage(m, rootPromise);
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

