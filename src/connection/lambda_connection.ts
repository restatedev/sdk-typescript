"use strict";

import { Connection } from "./connection";
import { encodeMessage } from "../io/encoder";
import {
  OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
  START_MESSAGE_TYPE,
  StartMessage,
  SUSPENSION_MESSAGE_TYPE
} from "../types/protocol";
import { decodeLambdaBody } from "../io/decoder";
import { Message } from "../types/types";
import { rlog } from "../utils/logger";
import { InvocationBuilder } from "../invocation";
import { HostedGrpcServiceMethod } from "../types/grpc";
import { ProtocolMode } from "../generated/proto/discovery";
import { StateMachine } from "../state_machine";

export class LambdaConnection<I,O> implements Connection {
  // Buffer with input messages
  private inputBase64: string;
  // Empty buffer to store journal output messages
  private outputBuffer: Buffer = Buffer.alloc(0);
  invocationBuilder = new InvocationBuilder<I, O>();
  private suspendedOrCompleted = false;
  // Callback to resolve the invocation promise of the Lambda handler when the response is ready
  private completionPromise: Promise<Buffer>;
  private resolveOnCompleted!: (value: Buffer | PromiseLike<Buffer>) => void;
  private onErrorListeners: (() => void)[] = [];

  constructor(body: string, method: HostedGrpcServiceMethod<I, O>) {
    // Decode the body coming from API Gateway (base64 encoded).
    this.inputBase64 = body;

    const decodedEntries = decodeLambdaBody(this.inputBase64);

    // First message should be the start message
    const firstMsg = decodedEntries.shift();
    if(!firstMsg || firstMsg.messageType !== START_MESSAGE_TYPE) {
      throw new Error("First message needs to be start message")
    }

    this.invocationBuilder
      .setGrpcMethod(method)
      .setProtocolMode(ProtocolMode.REQUEST_RESPONSE)
      .handleStartMessage(firstMsg.message as StartMessage);

    // Promise that signals when the invocation is over, to then flush the messages
    this.completionPromise = new Promise<Buffer>((resolve) => {
      this.resolveOnCompleted = resolve;
    });

    decodedEntries.forEach(el => this.invocationBuilder.addReplayEntry(el));

    const invocation = this.invocationBuilder.build();
    const stateMachine = new StateMachine(this, invocation);
    stateMachine.invoke();
  }

  // Send a message back to the runtime
  buffer(msg: Message): void {
    // Add the header and the body to buffer and add to the output buffer
    const msgBuffer = encodeMessage(msg);
    this.outputBuffer = Buffer.concat([this.outputBuffer, msgBuffer]);

    // An output message or suspension message is the end of a Lambda invocation
    if (
      msg.messageType === OUTPUT_STREAM_ENTRY_MESSAGE_TYPE ||
      msg.messageType === SUSPENSION_MESSAGE_TYPE
    ) {
      this.suspendedOrCompleted = true;
    }
  }

  async flush(): Promise<void> {
    if (this.suspendedOrCompleted) {
      rlog.debug("Flushing output buffer...");
      this.resolveOnCompleted(this.outputBuffer);
    }
  }

  getResult(): Promise<Buffer> {
    return this.completionPromise;
  }

  handleConnectionError(): void {
    this.end();
    this.emitOnErrorEvent();
  }

  // We use an error listener to notify the state machine of errors in the connection layer.
  // When there is a connection error (decoding/encoding/...), the statemachine is closed.
  public onError(listener: () => void) {
    this.onErrorListeners.push(listener);
  }

  private emitOnErrorEvent() {
    for (const listener of this.onErrorListeners) {
      listener();
    }
  }

  // This function is bind to the onClose() of the state machine
  onClose(): void {
    // Trigger cleanup
    this.end();
  }

  end(): void {
    this.inputBase64 = "";
    this.outputBuffer = Buffer.alloc(0);
  }
}
