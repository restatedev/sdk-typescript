"use strict";

import { ProtocolMessage } from "../types/protocol";
import stream from "stream";
import { Header } from "../types/types";
import { streamEncoder } from "../io/encoder";
import { streamDecoder } from "../io/decoder";

export type RestateDuplexStreamEventHandler = (
  messageType: bigint,
  message: ProtocolMessage | Uint8Array,
  completedFlag?: boolean,
  protocolVersion?: number,
  requiresAckFlag?: boolean
) => void;

export type RestateDuplexStreamErrorHandler = (err: Error) => void;

export class RestateDuplexStream {
  // create a RestateDuplex stream from an http2 (duplex) stream.
  public static from(http2stream: stream.Duplex): RestateDuplexStream {
    const sdkInput = http2stream.pipe(streamDecoder());

    const sdkOutput = streamEncoder();
    sdkOutput.pipe(http2stream);

    return new RestateDuplexStream(sdkInput, sdkOutput);
  }

  constructor(
    private readonly sdkInput: stream.Readable,
    private readonly sdkOutput: stream.Writable
  ) {}

  send(
    messageType: bigint,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    message: ProtocolMessage | Uint8Array,
    completed?: boolean,
    requiresAck?: boolean
  ) {
    this.sdkOutput.write({
      messageType: messageType,
      message,
      completed,
      requiresAck: requiresAck,
    });
  }

  onMessage(handler: RestateDuplexStreamEventHandler) {
    this.sdkInput.on("data", (data) => {
      const { header, message } = data;
      const h = header as Header;
      handler(
        h.messageType,
        message,
        h.completedFlag,
        h.protocolVersion,
        h.requiresAckFlag
      );
    });
  }

  onError(handler: RestateDuplexStreamErrorHandler) {
    this.sdkInput.on("error", (err) => {
      console.warn("Error in input stream: " + err.stack);
      handler(err);
    });
  }
}
