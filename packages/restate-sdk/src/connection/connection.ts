/*
 * Copyright (c) 2023-2024 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

import type stream from "node:stream/web";
import { streamDecoder } from "../io/decoder.js";
import type { Message } from "../types/types.js";
import { rlog } from "../logger.js";
import { encodeMessage } from "../io/encoder.js";
import { WritableStream } from "node:stream/web";

/**
 * A connection from the service/SDK to Restate.
 * Accepts messages to be sent and committed to the journal.
 */
export interface Connection {
  send(msg: Message): Promise<void>;

  end(): Promise<void>;

  headers(): ReadonlyMap<string, string | string[] | undefined>;
}

/**
 * A consumer of a message stream from Restate.
 * Messages include journal replay messages and completion messages.
 */
export interface RestateStreamConsumer {
  handleMessage(m: Message): boolean;

  handleStreamError(e: Error): void;

  handleInputClosed(): void;
}

/**
 * A stream with Restate Messages, potentially but not necessarily full duplex.
 *
 * This stream handles the following concerns:
 *
 * (1) encoding and decoding of messages to and from raw bytes
 *
 *
 * (2) Input messages can be pipelined to a sequence of consumers. For example, first to a journal,
 *     and afterwards to the state machine.
 *
 * (3) Handling the relevant stream events for errors and consolidating them to one error handler, plus
 *     notifications for cleanly closed input (to trigger suspension).
 */
export class RestateConnection implements Connection {
  /**
   * create a RestateBidiConnection stream from a duplex stream
   */
  public static from(
    headers: Record<string, string | string[] | undefined>,
    rawStream: stream.ReadableWritablePair<Uint8Array, Uint8Array>
  ): RestateConnection {
    return new RestateConnection(headers, rawStream);
  }

  // --------------------------------------------------------------------------

  private readonly sdkInputPipeline: Promise<void>;

  // consumer handling
  private currentConsumer: RestateStreamConsumer | null = null;
  private inputBuffer: Message[] = [];
  private consumerError?: Error;
  private consumerInputClosed = false;

  private readonly sdkOutput: stream.WritableStreamDefaultWriter<Uint8Array>;

  constructor(
    private readonly attemptHeaders: Record<
      string,
      string | string[] | undefined
    >,
    rawStream: stream.ReadableWritablePair<Uint8Array, Uint8Array>
  ) {
    // --------------------------------------------------------------------------
    //  input stream handling
    // --------------------------------------------------------------------------

    const sdkInputSink = new WritableStream<Message>({
      write: (m) => {
        // deliver message, if we have a consumer. otherwise buffer the message.
        if (this.currentConsumer) {
          if (this.currentConsumer.handleMessage(m)) {
            this.removeCurrentConsumer();
          }
        } else {
          this.inputBuffer.push(m);
        }
      },
      // this notifies of errors in the decoding pipeline as well as the incoming body stream
      abort: (e: Error) => {
        rlog.error(
          "Error in request stream from Restate: " + (e.stack ?? e.message)
        );
        errorHandler(e);
      },
      close: () => {
        // remember and forward close events
        this.consumerInputClosed = true;
        if (this.currentConsumer) {
          this.currentConsumer.handleInputClosed();
        }
      },
    });

    this.sdkInputPipeline = rawStream.readable
      .pipeThrough<Message>(streamDecoder())
      .pipeTo(sdkInputSink);

    this.sdkOutput = rawStream.writable.getWriter();

    // --------- error handling --------

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

    // this notifies of errors in the outgoing response stream
    this.sdkOutput.closed.catch((e: Error) => {
      rlog.error(
        "Error in response stream to Restate: " + (e.stack ?? e.message)
      );
      errorHandler(e);
    });

    // this notifies of errors in the decoding pipeline as well as the incoming body stream
    this.sdkInputPipeline.catch((e: Error) => {
      rlog.error(
        "Error in request stream from Restate: " + (e.stack ?? e.message)
      );
      errorHandler(e);
    });
  }

  headers(): ReadonlyMap<string, string | string[] | undefined> {
    return new Map(Object.entries(this.attemptHeaders));
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
  public async send(msg: Message): Promise<void> {
    const bytes = encodeMessage(msg);
    // don't await the write as it will not complete until data is completely flushed
    this.sdkOutput.write(bytes).catch(() => {});
    // however, do await until there is capacity for more, so there's backpressure
    await this.sdkOutput.ready;
  }

  /**
   * Ends the output stream, awaiting pending writes.
   */
  public async end(): Promise<void> {
    // we don't care if the stream had any errors at this point
    await this.sdkOutput.close().catch(() => {});
  }
}
