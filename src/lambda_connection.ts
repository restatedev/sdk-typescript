"use strict";

import { Connection } from "./bidirectional_server";
import { ProtocolMessage } from "./types";
import {
  encodeMessage,
  Header,
  InputEntry,
  MESSAGES_REQUIRING_COMPLETION,
  OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
  PROTOBUF_MESSAGE_BY_TYPE,
  RestateDuplexStreamEventHandler,
  SUSPENSION_MESSAGE_TYPE,
} from "./protocol_stream";
import { SuspensionMessage } from "./generated/proto/protocol";

const WAITING_FOR_HEADER = 0;
const WAITING_FOR_BODY = 1;

export class LambdaConnection implements Connection {
  // Buffer with input messages
  private inputBuffer: Buffer;
  // Empty buffer to store journal output messages
  private outputBuffer: Buffer = Buffer.alloc(0);
  // Callback to resolve the invocation promise of the Lambda handler when the response is ready
  private completionPromise: Promise<Buffer>;
  private resolveOnCompleted!: (value: Buffer | PromiseLike<Buffer>) => void;

  constructor(body: string | null) {
    if (body == null) {
      throw Error("The incoming message body was null");
    }

    this.inputBuffer = Buffer.from(body, "base64");
    this.completionPromise = new Promise<Buffer>((resolve) => {
      this.resolveOnCompleted = resolve;
    });
  }

  // Send a message back to the runtime
  send(
    message_type: bigint,
    message: ProtocolMessage | Uint8Array,
    completed?: boolean | undefined,
    requires_ack?: boolean | undefined,
    completable_indices?: number[] | undefined
  ): void {
    // Add the header and the body to buffer and add to the output buffer
    const msgBuffer = encodeMessage({
      message_type: message_type,
      message: message,
      completed: completed,
      requires_ack: requires_ack,
    });
    this.outputBuffer = Buffer.concat([this.outputBuffer, msgBuffer]);

    // Handle message types which require a completion or ack from the runtime
    // In request-response mode, this requires a suspension.
    if (MESSAGES_REQUIRING_COMPLETION.includes(message_type)) {
      if (completable_indices == undefined) {
        throw new Error(
          "Invocation requires completion but no completable entry indices known."
        );
      }

      const suspensionMsg = SuspensionMessage.create({
        entryIndexes: completable_indices,
      });
      const suspensionMsgBuffer = encodeMessage({
        message_type: SUSPENSION_MESSAGE_TYPE,
        message: suspensionMsg,
        completed: false,
        requires_ack: false,
      });

      this.outputBuffer = Buffer.concat([
        this.outputBuffer,
        suspensionMsgBuffer,
      ]);

      // A suspension is the end of a Lambda invocation
      this.resolveOnCompleted(this.outputBuffer);
    }

    if (message_type === OUTPUT_STREAM_ENTRY_MESSAGE_TYPE) {
      // An output message is the end of a Lambda invocation
      this.resolveOnCompleted(this.outputBuffer);
    }
  }

  // Process the incoming invocation message from the runtime
  onMessage(handler: RestateDuplexStreamEventHandler): void {
    console.debug("LambdaConnection: Called onMessage");

    const decodedEntries = LambdaConnection.decodeMessage(this.inputBuffer);
    decodedEntries.forEach((entry) =>
      handler(
        entry.header.message_type,
        entry.message,
        entry.header.completed_flag,
        entry.header.protocol_version,
        entry.header.requires_ack_flag
      )
    );
    return;
  }

  getResult(): Promise<Buffer> {
    return this.completionPromise;
  }

  // We don't need to explicitly clean up because Lambda always starts in a clean environment
  onClose(): void {
    return;
  }

  // We don't need to explicitly clean up because Lambda always starts in a clean environment
  end(): void {
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  addOnErrorListener(listener: () => void): void {
    return;
  }

  // Decodes messages from Lambda requests to an array of headers + protocol messages
  static decodeMessage(buffer: Buffer): InputEntry[] {
    let buf = buffer;
    let state = WAITING_FOR_HEADER;
    let header: Header | null = null;
    const decodedEntries: InputEntry[] = [];

    while (buf.length > 0) {
      switch (state) {
        case WAITING_FOR_HEADER: {
          console.debug("Parsing header");
          if (buf.length < 8) {
            throw new Error(
              "Parsing error: SDK cannot parse the message. Buffer was not empty but was too small to contain another header."
            );
          }
          const h = buf.readBigUInt64BE();
          buf = buf.subarray(8);
          header = Header.fromU64be(h);
          console.debug(header);
          state = WAITING_FOR_BODY;
          break;
        }
        case WAITING_FOR_BODY: {
          console.debug("Parsing body");
          if (header == null) {
            throw new Error(
              "Parsing error: SDK cannot parse the message. " +
                "Parsing body, while header was not parsed yet"
            );
          }
          if (buf.length < header.frame_length) {
            throw new Error(
              "Parsing error: SDK cannot parse the message. " +
                `Buffer length (${buf.length}) is smaller than frame length (${header.frame_length})`
            );
          }
          const frame = buf.subarray(0, header.frame_length);
          buf = buf.subarray(header.frame_length);
          state = WAITING_FOR_HEADER;

          const pbType = PROTOBUF_MESSAGE_BY_TYPE.get(header.message_type);
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
