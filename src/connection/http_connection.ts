"use strict";

import stream, { EventEmitter } from "stream";
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

    return new RestateHttp2Connection(sdkInput, sdkOutput, http2stream);
  }

  // --------------------------------------------------------------------------

  private _outputBuffer: Message[] = [];

  // consumer handling
  private currentConsumer: RestateStreamConsumer | null = null;
  private inputBuffer: Message[] = [];
  private consumerError?: Error;
  private consumerInputClosed = false;

  constructor(
    private readonly sdkInput: stream.Readable,
    private readonly sdkOutput: stream.Writable,
    errorEvents: EventEmitter
  ) {
    // remember and forward messages
    this.sdkInput.on("data", (m: Message) => {
      // deliver message, if we have a consumer. otherwise buffer the message.
      if (this.currentConsumer) {
        if (this.currentConsumer.handleMessage(m)) {
          this.removeCurrentConsumer();
        }
      } else {
        this.inputBuffer.push(m);
      }
    });

    // remember and forward close events
    this.sdkInput.on("end", () => {
      this.consumerInputClosed = true;
      if (this.currentConsumer) {
        this.currentConsumer.handleInputClosed();
      }
    });

    // --------- error handling --------
    // - a.k.a. node event wrangling...

    // the error handler for all sorts of errors coming from streams
    const errorHandler = (e: Error) => {
      // make sure we don't overwrite the initial error
      if (this.consumerError !== undefined) {
        return;
      }
      this.consumerError = e;
      if (this.currentConsumer) {
        this.currentConsumer.handleStreamError(e);
      }
    };

    // this event handles all types of connection loss
    errorEvents.on("aborted", () => {
      errorHandler(new Error("Connection to Restate was lost"));
    });

    // these events notify of errors in the pipeline, like encoding/decoding
    this.sdkInput.on("error", (e: Error) => {
      rlog.error("Error in input stream (Restate to Service): " + e.message);
      rlog.error(e.stack);
      errorHandler(e);
    });
    this.sdkOutput.on("error", (e: Error) => {
      rlog.error("Error in output stream (Service to  Restate): " + e.message);
      rlog.error(e.stack);
      errorHandler(e);
    });

    // see if streams get torn down before they end cleanly
    this.sdkInput.on("close", () => {
      if (!this.consumerInputClosed) {
        errorHandler(new Error("stream was destroyed before end"));
      }
    });
  }

  // --------------------------------------------------------------------------
  //  input stream handling
  // --------------------------------------------------------------------------

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

    this.currentConsumer = consumer;

    // propagate pre-existing information
    if (this.consumerError) {
      consumer.handleStreamError(this.consumerError);
    }
    if (this.consumerInputClosed) {
      consumer.handleInputClosed();
    }

    const input = this.inputBuffer;
    if (input.length > 0) {
      let i = 0;
      while (i < input.length) {
        const done = consumer.handleMessage(input[i]);
        i++;
        if (done) {
          // consumer is done
          this.removeCurrentConsumer();
          break;
        }
      }
      this.inputBuffer = i === input.length ? [] : this.inputBuffer.slice(i);
    }
  }

  /**
   * Removes the current consumer, if there is one.
   */
  public removeCurrentConsumer(): void {
    this.currentConsumer = null;
  }

  // --------------------------------------------------------------------------
  //  output stream handling
  // --------------------------------------------------------------------------

  public buffer(msg: Message): void {
    this._outputBuffer.push(msg);
  }

  public async flush(): Promise<void> {
    if (this._outputBuffer.length == 0) {
      return;
    }
    const buffer = this._outputBuffer;
    this._outputBuffer = [];

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
