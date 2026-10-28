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

// A scriptable, in-memory IngestionSvc: it records what the client sends, and each test decides
// what the server answers (window grants, acks, errors, end of stream).

import { create } from "@bufbuild/protobuf";
import {
  createRouterTransport,
  type HandlerContext,
  type Transport,
} from "@connectrpc/connect";
import {
  type ErrorKind,
  type IngestionInvocation,
  type IngestionRequest,
  type IngestionResponse,
  IngestionResponseSchema,
  type IngestionStart,
  IngestionSvc,
} from "../src/generated/dev/restate/ingress/ingestion/v1/ingestion_svc_pb.js";
import {
  connect,
  type IntegrationClient,
  type IntegrationClientOptions,
} from "../src/index.js";

const END = Symbol("end");

type Scripted = IngestionResponse | Error | typeof END;

class Channel<T> {
  readonly #items: T[] = [];
  readonly #waiters: ((item: T) => void)[] = [];

  push(item: T): void {
    const waiter = this.#waiters.shift();
    if (waiter !== undefined) {
      waiter(item);
    } else {
      this.#items.push(item);
    }
  }

  next(): Promise<T> {
    if (this.#items.length > 0) {
      return Promise.resolve(this.#items.shift()!);
    }
    return new Promise((resolve) => this.#waiters.push(resolve));
  }
}

export class FakeIngestion {
  readonly transport: Transport;
  readonly requests: IngestionRequest[] = [];
  requestHeaders: Headers | undefined;
  /** True once the client half-closed the request stream. */
  requestStreamEnded = false;
  /** Set when the request stream failed, e.g. because the client cancelled the call. */
  requestStreamError: unknown;

  readonly #responses = new Channel<Scripted>();
  readonly #autoAck: boolean;

  /**
   * @param autoAck - acknowledge every invocation as soon as it is received.
   */
  constructor({ autoAck = false }: { autoAck?: boolean } = {}) {
    this.#autoAck = autoAck;
    this.transport = createRouterTransport(({ service }) => {
      service(IngestionSvc, {
        ingest: (requests, context) => this.#ingest(requests, context),
      });
    });
  }

  client(options: Partial<IntegrationClientOptions> = {}): IntegrationClient {
    return connect({
      url: "http://localhost:8080",
      transport: this.transport,
      ...options,
    });
  }

  get start(): IngestionStart | undefined {
    const first = this.requests[0];
    return first?.kind.case === "start" ? first.kind.value : undefined;
  }

  get invocations(): IngestionInvocation[] {
    return this.requests.flatMap((request) =>
      request.kind.case === "invocation" ? [request.kind.value] : []
    );
  }

  get offsets(): number[] {
    return this.invocations.map((invocation) => Number(invocation.offset));
  }

  grantWindow(bytes: number): void {
    this.#responses.push(
      create(IngestionResponseSchema, {
        response: { case: "windowUpdate", value: { incrementBytes: bytes } },
      })
    );
  }

  ack(lastCommitted: number): void {
    this.#responses.push(
      create(IngestionResponseSchema, { lastCommitted: BigInt(lastCommitted) })
    );
  }

  /** Sends an Error frame, then ends the stream, as Restate does. */
  error(
    kind: ErrorKind,
    message: string,
    options: { offset?: number; lastCommitted?: number } = {}
  ): void {
    this.#responses.push(
      create(IngestionResponseSchema, {
        lastCommitted:
          options.lastCommitted !== undefined
            ? BigInt(options.lastCommitted)
            : undefined,
        response: {
          case: "error",
          value: {
            kind,
            message,
            invocationOffset:
              options.offset !== undefined ? BigInt(options.offset) : undefined,
          },
        },
      })
    );
    this.#responses.push(END);
  }

  /** Ends the response stream successfully. */
  end(): void {
    this.#responses.push(END);
  }

  /** Fails the call with a transport-level error. */
  failCall(error: Error): void {
    this.#responses.push(error);
  }

  async *#ingest(
    requests: AsyncIterable<IngestionRequest>,
    context: HandlerContext
  ): AsyncIterable<IngestionResponse> {
    this.requestHeaders = context.requestHeader;
    void this.#consume(requests);
    for (;;) {
      const next = await this.#responses.next();
      if (next === END) {
        return;
      }
      if (next instanceof Error) {
        throw next;
      }
      yield next;
    }
  }

  async #consume(requests: AsyncIterable<IngestionRequest>): Promise<void> {
    try {
      for await (const request of requests) {
        this.requests.push(request);
        if (this.#autoAck && request.kind.case === "invocation") {
          this.ack(Number(request.kind.value.offset));
        }
      }
      this.requestStreamEnded = true;
      // Like Restate: once the client half-closes, end the response stream.
      this.#responses.push(END);
    } catch (e) {
      this.requestStreamError = e;
    }
  }
}

/** Whether `promise` is still pending after the event loop had a chance to settle it. */
export async function isPending(promise: Promise<unknown>): Promise<boolean> {
  let settled = false;
  promise.then(
    () => (settled = true),
    () => (settled = true)
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  return !settled;
}
