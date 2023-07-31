"use strict";

import stream, { EventEmitter } from "stream";
import { pipeline, finished } from "stream/promises";
import { streamEncoder } from "../io/encoder";
import { streamDecoder } from "../io/decoder";
import { Connection, RestateStreamConsumer } from "./connection";
import { Message } from "../types/types";
import { rlog } from "../utils/logger";

/**
 * A duplex stream with Restate Messages over HTTP2.
 *
 * This stream handles the following concerns:
 *
 * (1) encoding and decoding of messages from  and from raw bytes
 *
 * (2) buffering the outgoing messages, because the call sites that produce (potentially) large
 *     messages might not await their transfer. Aside from the fact that we achieve better pipelining
 *     that way, we also simply cannot guarantee that users of the Restate SDK actually await the
 *     relevant async API methods.
 *
 *     This stream essentially buffers messages and, upon flush, sends them asynchronously, as the
 *     stream has availability. Flush requests queue up, if new data gets flushed while the previous
 *     data is still being sent.
 *
 * (3) Input messages can be pipelined to a sequence of consumers. For example, first to a journal,
 *     and afterwards to the state machine.
 *
 * (4) Handling the relevant stream events for errors and consolidating them to one error handler, plus
 *     notifications for cleanly closed input (to trigger suspension).
 */
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

  // output stream handling
  private outputBuffer: Message[] = [];
  private flushQueueTail: Promise<void> = Promise.resolve();

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

    // those two event types should cover all types of connection losses
    errorEvents.on("aborted", () => {
      rlog.error("Connection to Restate was lost");
      errorHandler(new Error("Connection to Restate was lost"));
    });
    errorEvents.on("error", (e: Error) => {
      rlog.error("Error in http2 stream to Restate: " + e.message);
      rlog.error(e.stack);
      errorHandler(e);
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

    // pipe the buffered input messages, if we buffered some before the consumer was registered
    const input = this.inputBuffer;
    if (input.length > 0) {
      let i = 0;
      while (i < input.length) {
        const done = consumer.handleMessage(input[i]);
        i++;
        if (done) {
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

  /**
   * Adds a message to the output buffer, but does not yet attempt to send it.
   * Messages are only actually sent when {@link flush} is called.
   */
  public buffer(msg: Message): void {
    this.outputBuffer.push(msg);
  }

  /**
   * Flushes all currently buffered messages to the output stream.
   * The returned promise resolves when the data has been fully flushed.
   *
   * If another flush operation is still ongoing (for example due to stream backpressure), then
   * this flush will start executing once the pending request(s) finished.
   */
  public async flush(): Promise<void> {
    if (this.outputBuffer.length == 0) {
      return;
    }

    const data = this.outputBuffer;
    this.outputBuffer = [];

    // this adds a new flush to the tail of the queue. If no flush is currently happening
    // (which is mostly the case) then the promise is already resolved and this flush starts
    // immediately.
    // NOTE: We do not add a '.catch()' because we want that, after one failure, all further flushes
    //       are skipped and promises rejected
    this.flushQueueTail = this.flushQueueTail.then(() => this.doFlush(data));
    return this.flushQueueTail;
  }

  private async doFlush(data: Message[]): Promise<void> {
    // pipeline creates a huge number of listeners, but it is not a leak; they are cleaned up by the time we complete
    // set to unlimited briefly
    const max = this.sdkOutput.getMaxListeners();
    try {
      this.sdkOutput.setMaxListeners(0);
      await pipeline(stream.Readable.from(data), this.sdkOutput, {
        end: false,
      });
    } finally {
      this.sdkOutput.setMaxListeners(max);
    }
  }

  /**
   * Ends the stream, awaiting pending flushes.
   */
  public async end(): Promise<void> {
    // ensure everything is written before we close the stream
    await this.flush();
    this.sdkOutput.end();

    // this here *would* be nice to surface errors (if the stream is broken), and
    // it normally should (like on file streams), but it seems that the way the node http2
    // stream is implemented, it never reports errors here
    await finished(this.sdkOutput);
    await finished(this.sdkInput);
  }
}
