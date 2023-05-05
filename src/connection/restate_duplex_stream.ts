"use strict";

import stream from "stream";
import { Message } from "../types/types";
import { streamEncoder } from "../io/encoder";
import { streamDecoder } from "../io/decoder";

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

  send(msg: Message) {
    this.sdkOutput.write(msg);
  }

  onMessage(handler: (msg: Message) => void) {
    this.sdkInput.on("data", (data) => {
      handler(data);
    });
  }

  onError(handler: (err: Error) => void) {
    this.sdkInput.on("error", (err) => {
      console.warn("Error in input stream: " + err.stack);
      handler(err);
    });
  }
}
