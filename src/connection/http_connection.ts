"use strict";

import stream from "stream";
import { encodeMessage } from "../io/encoder";
import { streamDecoder } from "../io/decoder";
import { Connection, RestateStreamConsumer } from "./connection";
import { Message } from "../types/types";
import { rlog } from "../utils/logger";
import { finished } from "stream/promises";

// utility promise, for cases where we want to save allocation of an extra promise
const RESOLVED: Promise<void> = Promise.resolve();

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
    return new RestateHttp2Connection(http2stream);
  }

  // --------------------------------------------------------------------------

  // input as decoded messages
  private readonly sdkInput: stream.Readable;

  // output as encoded bytes. we convert manually, not as transforms,
  // to skip a layer of stream indirection
  private readonly sdkOutput: stream.Writable;

  // consumer handling
  private currentConsumer: RestateStreamConsumer | null = null;
  private inputBuffer: Message[] = [];
  private consumerError?: Error;
  private consumerInputClosed = false;

  constructor(private readonly rawStream: stream.Duplex) {
    this.sdkInput = rawStream.pipe(streamDecoder());
    this.sdkOutput = rawStream;

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
    rawStream.on("aborted", () => {
      rlog.error("Connection to Restate was lost");
      errorHandler(new Error("Connection to Restate was lost"));
    });
    rawStream.on("error", (e: Error) => {
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
   * Adds a message to the output stream.
   *
   * This always puts the message into the node stream, but will return a promise that is resolved once
   * further messages can be written.
   *
   * The reasoning is that some, but not all Restate operations return promises and are typically
   * awaited. For example, rpc, sleep, side-effect have promises and are awaited, while one-way-sends and
   * state updates don't return promises.
   *
   * As a pragmatic solution, we always accept messages, but return a promise for when the output has
   * capacity again, so that at least the operations that await results will respect backpressure.
   */
  public send(msg: Message): Promise<void> {
    const encodedMessage: Uint8Array = encodeMessage(msg);

    const hasMoreCapacity = this.sdkOutput.write(encodedMessage);
    if (hasMoreCapacity) {
      return RESOLVED;
    }

    return new Promise((resolve) => {
      this.sdkOutput.once("drain", resolve);
    });
  }

  /**
   * Ends the stream, awaiting pending writes.
   */
  public async end(): Promise<void> {
    this.sdkOutput.end();

    const options = {
      error: true,
      cleanup: true,
    };

    await finished(this.rawStream, options);
  }
}
