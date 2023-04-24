"use strict";

import { Connection } from "./bidirectional_server";
import { ProtocolMessage } from "./types";
import {
  encodeMessage,
  Header,
  InputEntry,
  OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
  PROTOBUF_MESSAGE_BY_TYPE,
  RestateDuplexStreamEventHandler,
  SUSPENSION_MESSAGE_TYPE,
} from "./protocol_stream";

const WAITING_FOR_HEADER = 0;
const WAITING_FOR_BODY = 1;

export class LambdaConnection implements Connection {
  // Buffer with input messages
  private inputBase64: string;
  // Empty buffer to store journal output messages
  private outputBuffer: Buffer = Buffer.alloc(0);
  // Callback to resolve the invocation promise of the Lambda handler when the response is ready
  private completionPromise: Promise<Buffer>;
  private resolveOnCompleted!: (value: Buffer | PromiseLike<Buffer>) => void;
  private onErrorListeners: (() => void)[] = [];

  private static base64regex =
    /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;

  constructor(body: string | null) {
    if (body == null) {
      throw Error("The incoming message body was null");
    }

    // Decode the body coming from API Gateway (base64 encoded).
    this.inputBase64 = body;

    // Promise that signals when the invocation is over, to then flush the messages
    this.completionPromise = new Promise<Buffer>((resolve) => {
      this.resolveOnCompleted = resolve;
    });
  }

  // Send a message back to the runtime
  send(
    messageType: bigint,
    message: ProtocolMessage | Uint8Array,
    completed?: boolean | undefined,
    requiresAck?: boolean | undefined
  ): void {
    // Add the header and the body to buffer and add to the output buffer
    const msgBuffer = encodeMessage({
      messageType: messageType,
      message: message,
      completed: completed,
      requiresAck: requiresAck,
    });
    this.outputBuffer = Buffer.concat([this.outputBuffer, msgBuffer]);

    // An output message is the end of a Lambda invocation
    if (
      messageType === OUTPUT_STREAM_ENTRY_MESSAGE_TYPE ||
      messageType === SUSPENSION_MESSAGE_TYPE
    ) {
      this.resolveOnCompleted(this.outputBuffer);
    }
  }

  // Process the incoming invocation message from the runtime
  onMessage(handler: RestateDuplexStreamEventHandler): void {
    try {
      const decodedEntries = LambdaConnection.decodeMessage(this.inputBase64);
      decodedEntries.forEach((entry) =>
        handler(
          entry.header.messageType,
          entry.message,
          entry.header.completedFlag,
          entry.header.protocolVersion,
          entry.header.requiresAckFlag
        )
      );
    } catch (e) {
      console.error(e);
      console.trace();
      console.log("Closing the connection and state machine.");
      this.onError();
    }
  }

  getResult(): Promise<Buffer> {
    return this.completionPromise;
  }

  onError(): void {
    this.end();
    this.emitOnErrorEvent();
  }

  // We use an error listener to notify the state machine of errors in the connection layer.
  // When there is a connection error (decoding/encoding/...), the statemachine is closed.
  public addOnErrorListener(listener: () => void) {
    this.onErrorListeners.push(listener);
  }

  private emitOnErrorEvent() {
    for (const listener of this.onErrorListeners) {
      listener();
    }
  }

  onClose(): void {
    // Trigger cleanup
    this.end();
  }

  end(): void {
    console.log("Handler cleanup...");
    this.inputBase64 = "";
    this.outputBuffer = Buffer.alloc(0);
  }

  // Decodes messages from Lambda requests to an array of headers + protocol messages
  static decodeMessage(msgBase64: string): InputEntry[] {
    if (!this.base64regex.test(msgBase64)) {
      throw new Error(
        "Parsing error: SDK cannot parse the message. Message was not valid base64 encoded."
      );
    }

    let buf = Buffer.from(msgBase64, "base64");
    let state = WAITING_FOR_HEADER;
    let header: Header | null = null;
    const decodedEntries: InputEntry[] = [];

    while (buf.length > 0) {
      switch (state) {
        case WAITING_FOR_HEADER: {
          if (buf.length < 8) {
            throw new Error(
              "Parsing error: SDK cannot parse the message. Buffer was not empty but was too small to contain another header."
            );
          }
          const h = buf.readBigUInt64BE();
          buf = buf.subarray(8);
          header = Header.fromU64be(h);
          state = WAITING_FOR_BODY;
          break;
        }
        case WAITING_FOR_BODY: {
          if (header == null) {
            throw new Error(
              "Parsing error: SDK cannot parse the message. " +
                "Parsing body, while header was not parsed yet"
            );
          }
          if (buf.length < header.frameLength) {
            throw new Error(
              "Parsing error: SDK cannot parse the message. " +
                `Buffer length (${buf.length}) is smaller than frame length (${header.frameLength})`
            );
          }
          const frame = buf.subarray(0, header.frameLength);
          buf = buf.subarray(header.frameLength);

          const pbType = PROTOBUF_MESSAGE_BY_TYPE.get(header.messageType);
          if (pbType === undefined) {
            // this is a custom message.
            // we don't know how to decode custom message
            // so we let the user of this stream to deal with custom
            // message serde
            decodedEntries.push(new InputEntry(header, frame));
          } else {
            const message = pbType.decode(frame);
            decodedEntries.push(new InputEntry(header, message));
          }

          // Reset the state and the header, to start parsing the next msg
          state = WAITING_FOR_HEADER;
          header = null;
        }
      }
    }

    return decodedEntries;
  }
}
