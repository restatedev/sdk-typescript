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
import type { Connection, RestateStreamConsumer } from "./connection.js";
import type { Message } from "../types/types.js";
import { rlog } from "../logger.js";
import { encodeMessage } from "../io/encoder.js";

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
export class RestateBidiConnection implements Connection {
  /**
   * create a RestateBidiConnection stream from a duplex stream
   */
  public static from(
    headers: Record<string, string | string[] | undefined>,
    rawStream: stream.ReadableWritablePair<Uint8Array, Uint8Array>
  ): RestateBidiConnection {
    return new RestateBidiConnection(headers, rawStream);
  }

  // --------------------------------------------------------------------------

  // input as decoded messages
  private readonly sdkInput: stream.ReadableStream<Message>;

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
    this.sdkInput = rawStream.readable.pipeThrough<Message>(streamDecoder());

    this.sdkOutput = rawStream.writable.getWriter();

    // remember and forward messages
    const messageIterator = this.messageIterator();

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

    // this notifies of errors in the outgoing response stream
    this.sdkOutput.closed.catch((e: Error) => {
      rlog.error(
        "Error in response stream to Restate: " + (e.stack ?? e.message)
      );
      errorHandler(e);
    });

    // this notifies of errors in the decoding pipeline as well as the incoming body stream
    messageIterator.catch((e: Error) => {
      rlog.error(
        "Error in request stream from Restate: " + (e.stack ?? e.message)
      );
      errorHandler(e);
    });
  }

  headers(): ReadonlyMap<string, string | string[] | undefined> {
    return new Map(Object.entries(this.attemptHeaders));
  }

  // --------------------------------------------------------------------------
  //  input stream handling
  // --------------------------------------------------------------------------

  private async messageIterator() {
    for await (const m of this.sdkInput) {
      // deliver message, if we have a consumer. otherwise buffer the message.
      if (this.currentConsumer) {
        if (this.currentConsumer.handleMessage(m)) {
          this.removeCurrentConsumer();
        }
      } else {
        this.inputBuffer.push(m);
      }
    }
    // remember and forward close events
    this.consumerInputClosed = true;
    if (this.currentConsumer) {
      this.currentConsumer.handleInputClosed();
    }
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
   * Ends the stream, awaiting pending writes.
   */
  public async end(): Promise<void> {
    // we don't care if the stream had any errors at this point
    await this.sdkInput.cancel().catch(() => {});
    await this.sdkOutput.close().catch(() => {});
  }
}
