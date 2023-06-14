"use strict";

import stream from "stream";
import { pipeline } from "stream/promises";
import { streamEncoder } from "../io/encoder";
import { streamDecoder } from "../io/decoder";
import { Connection, RestateStreamConsumer } from "./connection";
import { Message } from "../types/types";
import { rlog } from "../utils/logger";

export class RestateHttp2Connection implements Connection {
  /**
   * create a RestateDuplex stream from an http2 (duplex) stream.
   */
  public static from(http2stream: stream.Duplex): RestateHttp2Connection {
    const sdkInput = http2stream.pipe(streamDecoder());

    const sdkOutput = streamEncoder();
    sdkOutput.pipe(http2stream);

    return new RestateHttp2Connection(sdkInput, sdkOutput);
  }

  // --------------------------------------------------------------------------

  private _buffer: Message[] = [];
  private currentConsumer: RestateStreamConsumer | null = null;

  constructor(
    private readonly sdkInput: stream.Readable,
    private readonly sdkOutput: stream.Writable
  ) {
    // install default logging for errors
    this.sdkInput.on("error", (e: Error) => {
      rlog.error(
        "Error in input stream (from Restate to SDK/Service): " + e.message
      );
      rlog.error(e.stack);
    });
    this.sdkOutput.on("error", (e: Error) => {
      rlog.error(
        "Error in output stream (from SDK/Service to  Restate): " + e.message
      );
      rlog.error(e.stack);
    });
  }

  /**
   * Pipes the messages from this connection to the given consumer. The consumer
   * will also receive error and stream closing notifications.
   *
   * Once the 'handleMessage()' method returns 'true', the consumer is immediately removed.
   * That way, consumers can consume a bounded amount of messages (like just the initial journal).
   *
   * There can only be one consumer at a time.
   */
  public pipeToConsumer(consumer: RestateStreamConsumer): void {
    if (this.currentConsumer !== null) {
      throw new Error("Already piping to a consumer");
    }

    const handleMessage = (m: Message) => {
      const done = consumer.handleMessage(m);
      if (done) {
        this.removeCurrentConsumer();
      }
      return done;
    };
    const handleInputClosed = consumer.handleInputClosed.bind(consumer);
    const handleStreamError = consumer.handleStreamError.bind(consumer);
    this.currentConsumer = {
      handleMessage,
      handleInputClosed,
      handleStreamError,
    };

    this.sdkInput.on("data", handleMessage);
    this.sdkInput.on("close", handleInputClosed);
    this.sdkInput.on("error", handleStreamError);
    this.sdkOutput.on("error", handleStreamError);
  }

  /**
   * Removes the current consumer, if there is one. Otherwise does nothing.
   */
  public removeCurrentConsumer(): void {
    if (this.currentConsumer === null) {
      return;
    }
    const c = this.currentConsumer;
    this.currentConsumer = null;
    this.sdkInput.removeListener("data", c.handleMessage);
    this.sdkInput.removeListener("close", c.handleInputClosed);
    this.sdkInput.removeListener("error", c.handleStreamError);
    this.sdkOutput.removeListener("error", c.handleStreamError);
  }

  public buffer(msg: Message): void {
    this._buffer.push(msg);
  }

  public async flush(): Promise<void> {
    if (this._buffer.length == 0) {
      return;
    }
    const buffer = this._buffer;
    this._buffer = [];

    const max = this.sdkOutput.getMaxListeners();
    // pipeline creates a huge number of listeners, but it is not a leak; they are cleaned up by the time we complete
    // set to unlimited briefly
    this.sdkOutput.setMaxListeners(0);
    await pipeline(stream.Readable.from(buffer), this.sdkOutput, {
      end: false,
    });
    this.sdkOutput.setMaxListeners(max);
  }

  public end() {
    this.sdkOutput.end();
  }
}
