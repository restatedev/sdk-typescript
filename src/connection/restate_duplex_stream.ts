"use strict";

import stream from "stream";
import { Message } from "../types/types";
import { streamEncoder } from "../io/encoder";
import { streamDecoder } from "../io/decoder";
import { rlog } from "../utils/logger";
import { pipeline } from "stream/promises";

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

  async send(msgs: Message[]): Promise<void> {
    const max = this.sdkOutput.getMaxListeners();
    // pipeline creates a huge number of listeners, but it is not a leak; they are cleaned up by the time we complete
    // set to unlimited briefly
    this.sdkOutput.setMaxListeners(0);
    await pipeline(stream.Readable.from(msgs), this.sdkOutput, { end: false });
    this.sdkOutput.setMaxListeners(max);
  }

  end() {
    this.sdkOutput.end();
  }

  onMessage(handler: (msg: Message) => void) {
    this.sdkInput.on("data", (data) => {
      handler(data);
    });
  }

  onError(handler: (err: Error) => void) {
    this.sdkInput.on("error", (err) => {
      rlog.warn("Error in input stream: " + err.stack);
      handler(err);
    });
  }
}
