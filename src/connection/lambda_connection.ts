"use strict";

import { Connection } from "./connection";
import { encodeMessage } from "../io/encoder";
import {
  OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
  SUSPENSION_MESSAGE_TYPE,
} from "../types/protocol";
import { decodeLambdaBody } from "../io/decoder";
import { Message } from "../types/types";
import { rlog } from "../utils/logger";

export class LambdaConnection implements Connection {
  // Buffer with input messages
  private inputBase64: string;
  // Empty buffer to store journal output messages
  private outputBuffer: Buffer = Buffer.alloc(0);
  private suspendedOrCompleted = false;
  // Callback to resolve the invocation promise of the Lambda handler when the response is ready
  private completionPromise: Promise<Buffer>;
  private resolveOnCompleted!: (value: Buffer | PromiseLike<Buffer>) => void;
  private onErrorListeners: (() => void)[] = [];

  constructor(body: string) {
    // Decode the body coming from API Gateway (base64 encoded).
    this.inputBase64 = body;

    // Promise that signals when the invocation is over, to then flush the messages
    this.completionPromise = new Promise<Buffer>((resolve) => {
      this.resolveOnCompleted = resolve;
    });
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

  // Process the incoming invocation message from the runtime
  onMessage(handler: (msg: Message) => void): void {
    try {
      const decodedEntries = decodeLambdaBody(this.inputBase64);
      decodedEntries.forEach((msg) => handler(msg));
    } catch (e) {
      rlog.error(e);
      rlog.debug("Closing the connection and state machine.");
      this.handleConnectionError();
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
