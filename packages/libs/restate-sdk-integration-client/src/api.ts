/*
 * Copyright (c) 2023-2026 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

import type { Transport } from "@connectrpc/connect";

/**
 * Options for {@link connect}.
 *
 * @experimental
 */
export interface IntegrationClientOptions {
  /**
   * Restate ingress URL, e.g. `http://localhost:8080`. `https` selects TLS.
   */
  url: string;

  /**
   * Bearer token, sent as the `authorization` header of every ingestion stream.
   */
  authToken?: string;

  /**
   * Identifies the integration to Restate, as `name/version`. Restate records it on
   * traces and metrics. Longer than 64 bytes, it is truncated.
   *
   * Defaults to this client's own identity, `restate-integration-client-ts/<version>`.
   */
  integration?: { name: string; version: string };

  /**
   * Connect transport to use instead of opening a new HTTP/2 connection to
   * {@link IntegrationClientOptions.url}.
   * The transport remains owned by the caller and {@link IntegrationClient.close} does not
   * close it.
   */
  transport?: Transport;
}

/**
 * Entry point for producing invocations to Restate through the ingestion API.
 *
 * @experimental
 */
export interface IntegrationClient {
  /**
   * Creates an at-least-once {@link Producer}. Offsets are assigned automatically, and
   * records resent on a new stream are not deduplicated: set {@link Invocation.idempotencyKey}
   * when handler-level deduplication is required.
   */
  producer(opts?: ProducerOptions): Producer;

  /**
   * Creates an {@link ExactlyOnceProducer}. Restate deduplicates on `(producerId, offset)`, so
   * choose a producer id that is stable across restarts and distinct per independent offset
   * sequence, e.g. a Kafka `groupId/topic/partition`.
   *
   * @param producerId - stable identity of the producer, non-empty and at most 256 bytes.
   */
  exactlyOnceProducer(
    producerId: string,
    opts?: ProducerOptions
  ): ExactlyOnceProducer;

  /**
   * Closes the HTTP/2 connection opened by this client. Close (or flush) the producers
   * first when their records must be durably committed.
   */
  close(): Promise<void>;
}

/**
 * Invocation fields shared by every record of a producer, see {@link ProducerOptions.defaults}.
 *
 * @experimental
 */
export interface InvocationDefaults {
  /** Target service name. */
  service?: string;
  /** Target handler name. */
  handler?: string;
  /** Target key, required when the target is a Virtual Object or a Workflow. */
  key?: string;
  /** Invocation scope. */
  scope?: string;
  /** Concurrency/rate limit key. */
  limitKey?: string;
  /** Headers. A record's own headers are added to these, overriding the same keys. */
  headers?: Record<string, string>;
}

/**
 * A record to send through a {@link Producer}. Fields set here override the producer
 * {@link ProducerOptions.defaults}.
 *
 * @experimental
 */
export interface Invocation extends InvocationDefaults {
  /** Invocation payload. Strings are encoded as UTF-8. */
  body?: Uint8Array | string;
  /** Idempotency key used by Restate to deduplicate the invocation. */
  idempotencyKey?: string;
  /** Schedule the invocation at this time. */
  invokeAt?: Date;
  /** W3C `traceparent`. */
  traceparent?: string;
  /** W3C `tracestate`. */
  tracestate?: string;
}

/**
 * A record to send through an {@link ExactlyOnceProducer}.
 *
 * @experimental
 */
export interface ExactlyOnceInvocation extends Invocation {
  /**
   * Position of this record in the source, e.g. a Kafka offset. Must be strictly greater than
   * the offset of the previous record sent by this producer, and at most
   * `Number.MAX_SAFE_INTEGER`. Gaps are allowed.
   */
  offset: number;
}

/**
 * Options for {@link IntegrationClient.producer} and {@link IntegrationClient.exactlyOnceProducer}.
 *
 * @experimental
 */
export interface ProducerOptions {
  /**
   * Fields applied to every record unless the record sets them itself. They are sent
   * once, when the stream is opened.
   */
  defaults?: InvocationDefaults;

  /**
   * Maximum combined serialized size of the records waiting to be written to the stream.
   * While the buffer is full, {@link ProducerBase.send} waits. Zero disables the buffer:
   * `send` then waits until the record can be written to the stream directly.
   *
   * Defaults to 32 MiB.
   */
  bufferBytes?: number;

  /**
   * Called with the commit watermark every time it advances: every record with an offset up
   * to and including it is durably committed by Restate. Use it to checkpoint an
   * exactly-once source.
   *
   * If the callback throws, the producer is aborted with the thrown error.
   */
  onCommitted?: (offset: number) => void;
}

/**
 * Options for {@link ProducerBase.send}.
 *
 * @experimental
 */
export interface SendOptions {
  /**
   * Wait until the record is durably committed by Restate, instead of only until it is
   * accepted by the producer.
   */
  waitCommitted?: boolean;
}

/**
 * Operations shared by {@link Producer} and {@link ExactlyOnceProducer}.
 *
 * A producer owns one ingestion stream. Errors are terminal: once the stream fails, every
 * pending and later operation rejects with the same error, and a new producer is needed.
 *
 * @experimental
 */
export interface ProducerBase<R extends Invocation> {
  /**
   * Sends a record.
   *
   * The returned promise resolves with the record offset once the producer has accepted the
   * record into its buffer (or, with `bufferBytes: 0`, written it to the stream), waiting
   * while the buffer is full. With `waitCommitted`, it resolves once Restate has durably
   * committed the record instead.
   *
   * Always await `send`: calls that are not awaited keep waiting for buffer space without
   * any bound. Records are sent in call order, so concurrent calls, e.g. with `Promise.all`,
   * are safe. Note that a record rejected by validation (an oversized record, or a
   * non-increasing exactly-once offset) rejects only its own call, while the others are
   * still sent: with an exactly-once producer, validate records before sending them
   * concurrently, or the commit watermark can move past the rejected offset.
   */
  send(record: R, opts?: SendOptions): Promise<number>;

  /**
   * Waits until every record sent so far is durably committed.
   *
   * @returns the commit watermark, or -1 if nothing was sent.
   */
  flush(): Promise<number>;

  /**
   * Flushes the producer, then closes its stream.
   */
  close(): Promise<void>;

  /**
   * Closes the producer immediately, without flushing. Every pending operation rejects
   * with `reason`.
   */
  abort(reason?: unknown): void;

  /**
   * A `WritableStream` view of this producer, to pipe a source into it, e.g. with
   * `ReadableStream.pipeTo` or Node's `stream/promises` `pipeline`. Writing sends the
   * record, closing the stream closes the producer and aborting it aborts the producer.
   */
  readonly writable: WritableStream<R>;
}

/**
 * Sends invocations to Restate with at-least-once delivery.
 *
 * @experimental
 */
export type Producer = ProducerBase<Invocation>;

/**
 * Sends invocations to Restate with exactly-once delivery: Restate deduplicates records on
 * `(producerId, offset)`, across streams and restarts. After a restart, resend from the
 * last checkpointed offset and Restate drops the records it already committed.
 *
 * @experimental
 */
export interface ExactlyOnceProducer extends ProducerBase<ExactlyOnceInvocation> {
  /** Stable identity of this producer. */
  readonly producerId: string;
}
