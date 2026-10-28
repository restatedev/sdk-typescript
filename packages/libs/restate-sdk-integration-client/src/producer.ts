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

import { create, toBinary } from "@bufbuild/protobuf";
import type { Client } from "@connectrpc/connect";
import type {
  ExactlyOnceInvocation,
  Invocation,
  ProducerBase,
  ProducerOptions,
  SendOptions,
} from "./api.js";
import {
  errorFromProto,
  IntegrationClientError,
  toSafeNumber,
} from "./errors.js";
import {
  DeduplicationMode,
  IngestionInvocationSchema,
  type IngestionRequest,
  IngestionRequestSchema,
  type IngestionResponse,
  type IngestionSvc,
} from "./generated/dev/restate/ingress/ingestion/v1/ingestion_svc_pb.js";
import { toProtoDefaults, toProtoInvocation } from "./proto.js";
import { Queue } from "./queue.js";

// The protocol guarantees a minimum send window of 32 KiB. The client assumes it as its initial
// credit instead of waiting for a first WindowUpdate; every WindowUpdate grows it from there.
const INITIAL_WINDOW_BYTES = 32 * 1024;

const DEFAULT_BUFFER_BYTES = 32 * 1024 * 1024;

export interface ProducerConfig {
  readonly rpc: Client<typeof IngestionSvc>;
  readonly headers: Record<string, string> | undefined;
  readonly integration: string;
  /** Empty for at-least-once producers. */
  readonly producerId: string;
  readonly exactlyOnce: boolean;
  readonly options: ProducerOptions;
}

interface PendingRecord {
  readonly offset: number;
  readonly request: IngestionRequest;
  // Serialized size of the invocation, the unit of both bufferBytes and the Restate window.
  readonly size: number;
}

interface AdmissionWaiter {
  readonly record: PendingRecord;
  readonly resolve: (offset: number) => void;
  readonly reject: (reason: unknown) => void;
}

interface CommitWaiter {
  readonly offset: number;
  readonly resolve: (watermark: number) => void;
  readonly reject: (reason: unknown) => void;
}

/**
 * Owns one ingestion stream.
 *
 * A record goes from `send` to the admission queue, where it waits in FIFO order while the
 * buffer is full, then to the buffer, then to the request generator that Connect consumes. Connect
 * pulls the next request only once HTTP/2 has accepted the previous one, and the buffer hands a
 * record to the generator only while the Restate window has credit, so both transport and Restate
 * backpressure propagate back to `send`.
 */
export class ProducerImpl<R extends Invocation> implements ProducerBase<R> {
  readonly #producerId: string;
  readonly #exactlyOnce: boolean;
  readonly #bufferBytes: number;
  readonly #onCommitted: ((offset: number) => void) | undefined;
  readonly #call = new AbortController();
  readonly #responsesDone: Promise<void>;

  readonly #admission = new Queue<AdmissionWaiter>();
  readonly #buffer = new Queue<PendingRecord>();
  #bufferedBytes = 0;
  // Ordered by offset: send() and flush() register increasing offsets.
  readonly #commitWaiters = new Queue<CommitWaiter>();

  // Remaining Restate window; may go one record negative, as the protocol allows.
  #budget = INITIAL_WINDOW_BYTES;
  // Highest offset accepted by send(), including records still waiting for admission.
  #lastSent = -1;
  #lastCommitted = -1;
  // Set while the request generator waits for its next request.
  #pull: ((request: IngestionRequest | undefined) => void) | undefined;
  #requestsEnded = false;
  #closing: Promise<void> | undefined;
  #failed = false;
  #failure: unknown;

  #writable: WritableStream<R> | undefined;
  #writableController: WritableStreamDefaultController | undefined;

  constructor(config: ProducerConfig) {
    const bufferBytes = config.options.bufferBytes ?? DEFAULT_BUFFER_BYTES;
    if (!Number.isSafeInteger(bufferBytes) || bufferBytes < 0) {
      throw new RangeError(
        `bufferBytes must be a non-negative integer, got ${bufferBytes}`
      );
    }
    this.#producerId = config.producerId;
    this.#exactlyOnce = config.exactlyOnce;
    this.#bufferBytes = bufferBytes;
    this.#onCommitted = config.options.onCommitted;

    const start = create(IngestionRequestSchema, {
      kind: {
        case: "start",
        value: {
          producerId: config.producerId,
          integration: config.integration,
          deduplicationMode: config.exactlyOnce
            ? DeduplicationMode.OFFSET_BASED
            : DeduplicationMode.DISABLED,
          defaults:
            config.options.defaults !== undefined
              ? toProtoDefaults(config.options.defaults)
              : undefined,
        },
      },
    });
    const responses = config.rpc.ingest(this.#requests(start), {
      signal: this.#call.signal,
      headers: config.headers,
    });
    this.#responsesDone = this.#readResponses(responses);
  }

  get producerId(): string {
    return this.#producerId;
  }

  send(record: R, opts?: SendOptions): Promise<number> {
    if (this.#failed) {
      // The failure is an abort() reason, which, like AbortController's, can be any value.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      return Promise.reject(this.#failure);
    }
    if (this.#closing !== undefined) {
      return Promise.reject(new Error("The producer is closed"));
    }

    let offset: number;
    if (this.#exactlyOnce) {
      offset = (record as Invocation as ExactlyOnceInvocation).offset;
      if (!Number.isSafeInteger(offset) || offset < 0) {
        return Promise.reject(
          new RangeError(
            `offset must be a non-negative safe integer, got ${offset}`
          )
        );
      }
      if (offset <= this.#lastSent) {
        return Promise.reject(
          new RangeError(
            `offset must be strictly increasing: last sent ${this.#lastSent}, got ${offset}`
          )
        );
      }
    } else {
      offset = this.#lastSent + 1;
      if (!Number.isSafeInteger(offset)) {
        return Promise.reject(
          new RangeError("The producer offset sequence is exhausted")
        );
      }
    }

    let pending: PendingRecord;
    try {
      const invocation = toProtoInvocation(record, offset);
      pending = {
        offset,
        size: toBinary(IngestionInvocationSchema, invocation).byteLength,
        request: create(IngestionRequestSchema, {
          kind: { case: "invocation", value: invocation },
        }),
      };
    } catch (e) {
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      return Promise.reject(e);
    }
    if (this.#bufferBytes > 0 && pending.size > this.#bufferBytes) {
      return Promise.reject(
        new RangeError(
          `The serialized record takes ${pending.size} bytes, more than bufferBytes (${this.#bufferBytes})`
        )
      );
    }

    this.#lastSent = offset;
    const accepted = new Promise<number>((resolve, reject) => {
      this.#admission.push({ record: pending, resolve, reject });
    });
    this.#drive();
    if (opts?.waitCommitted !== true) {
      return accepted;
    }
    return Promise.all([accepted, this.#committed(offset)]).then(() => offset);
  }

  flush(): Promise<number> {
    return this.#committed(this.#lastSent);
  }

  close(): Promise<void> {
    this.#closing ??= this.#close();
    return this.#closing;
  }

  abort(reason?: unknown): void {
    this.#fail(
      reason ??
        new IntegrationClientError("unknown", "The producer was aborted")
    );
  }

  get writable(): WritableStream<R> {
    // The default highWaterMark of one record is enough: the producer buffer is the real buffer,
    // and write() waits on it.
    this.#writable ??= new WritableStream<R>({
      start: (controller) => {
        this.#writableController = controller;
        if (this.#failed) {
          controller.error(this.#failure);
        }
      },
      write: async (record) => {
        await this.send(record);
      },
      close: () => this.close(),
      abort: (reason) => this.abort(reason),
    });
    return this.#writable;
  }

  async #close(): Promise<void> {
    if (this.#failed) {
      throw this.#failure;
    }
    await this.flush();
    // Half-close the request stream; Restate then ends the response stream.
    this.#requestsEnded = true;
    this.#drive();
    await this.#responsesDone;
    if (this.#failed) {
      throw this.#failure;
    }
  }

  async *#requests(start: IngestionRequest): AsyncGenerator<IngestionRequest> {
    yield start;
    for (;;) {
      const request = await new Promise<IngestionRequest | undefined>(
        (resolve) => {
          this.#pull = resolve;
          this.#drive();
        }
      );
      if (request === undefined) {
        return;
      }
      yield request;
    }
  }

  /** Moves records along: hands the buffer head to the waiting generator, admits waiting sends. */
  #drive(): void {
    for (;;) {
      if (this.#pull !== undefined) {
        if (
          this.#failed ||
          (this.#requestsEnded && this.#buffer.length === 0)
        ) {
          this.#takePull()(undefined);
          return;
        }
        if (this.#budget > 0) {
          const record = this.#buffer.shift();
          if (record !== undefined) {
            this.#bufferedBytes -= record.size;
            this.#budget -= record.size;
            this.#takePull()(record.request);
            continue;
          }
        }
      }
      const waiter = this.#admission.peek();
      if (waiter === undefined || !this.#canAdmit(waiter.record.size)) {
        return;
      }
      this.#admission.shift();
      this.#buffer.push(waiter.record);
      this.#bufferedBytes += waiter.record.size;
      waiter.resolve(waiter.record.offset);
    }
  }

  #canAdmit(size: number): boolean {
    if (this.#failed) {
      return false;
    }
    if (this.#bufferBytes === 0) {
      // Without a buffer, admit only what the generator can take right away.
      return (
        this.#pull !== undefined &&
        this.#budget > 0 &&
        this.#buffer.length === 0
      );
    }
    return this.#bufferedBytes + size <= this.#bufferBytes;
  }

  #takePull(): (request: IngestionRequest | undefined) => void {
    const pull = this.#pull!;
    this.#pull = undefined;
    return pull;
  }

  #committed(offset: number): Promise<number> {
    if (offset <= this.#lastCommitted) {
      return Promise.resolve(this.#lastCommitted);
    }
    if (this.#failed) {
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      return Promise.reject(this.#failure);
    }
    return new Promise((resolve, reject) => {
      this.#commitWaiters.push({ offset, resolve, reject });
    });
  }

  async #readResponses(
    responses: AsyncIterable<IngestionResponse>
  ): Promise<void> {
    try {
      for await (const response of responses) {
        if (response.lastCommitted !== undefined) {
          this.#advanceCommitted(toSafeNumber(response.lastCommitted));
        }
        if (this.#failed) {
          return;
        }
        if (response.response.case === "windowUpdate") {
          this.#budget += response.response.value.incrementBytes;
          this.#drive();
        } else if (response.response.case === "error") {
          // Always the last frame: Restate tears the stream down after it.
          this.#fail(errorFromProto(response.response.value));
          return;
        }
      }
      if (!this.#requestsEnded) {
        this.#fail(
          new IntegrationClientError(
            "unknown",
            "The ingestion stream was closed by the server"
          )
        );
      }
    } catch (e) {
      this.#fail(
        new IntegrationClientError(
          "unknown",
          `The ingestion stream failed: ${e instanceof Error ? e.message : String(e)}`,
          { cause: e }
        )
      );
    }
  }

  #advanceCommitted(watermark: number): void {
    if (watermark <= this.#lastCommitted) {
      return;
    }
    this.#lastCommitted = watermark;
    for (
      let waiter = this.#commitWaiters.peek();
      waiter !== undefined && waiter.offset <= watermark;
      waiter = this.#commitWaiters.peek()
    ) {
      this.#commitWaiters.shift();
      waiter.resolve(watermark);
    }
    if (this.#onCommitted !== undefined) {
      try {
        this.#onCommitted(watermark);
      } catch (e) {
        this.#fail(e);
      }
    }
  }

  /** Makes the producer terminally failed: cancels the stream and rejects everything pending. */
  #fail(reason: unknown): void {
    if (this.#failed) {
      return;
    }
    this.#failed = true;
    this.#failure = reason;
    this.#buffer.drain();
    this.#bufferedBytes = 0;
    const admission = this.#admission.drain();
    const commits = this.#commitWaiters.drain();
    if (this.#pull !== undefined) {
      this.#takePull()(undefined);
    }
    this.#call.abort(reason);
    this.#writableController?.error(reason);
    for (const waiter of admission) {
      waiter.reject(reason);
    }
    for (const waiter of commits) {
      waiter.reject(reason);
    }
  }
}
