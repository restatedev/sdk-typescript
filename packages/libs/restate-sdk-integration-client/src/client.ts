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

import { type Client, createClient } from "@connectrpc/connect";
import {
  createGrpcTransport,
  Http2SessionManager,
} from "@connectrpc/connect-node";
import pkg from "../package.json" with { type: "json" };
import type {
  ExactlyOnceInvocation,
  ExactlyOnceProducer,
  IntegrationClient,
  IntegrationClientOptions,
  Invocation,
  Producer,
  ProducerOptions,
} from "./api.js";
import { IngestionSvc } from "./generated/dev/restate/ingress/ingestion/v1/ingestion_svc_pb.js";
import { ProducerImpl } from "./producer.js";

// Limits enforced by Restate on the Start frame.
const MAX_INTEGRATION_BYTES = 64;
const MAX_PRODUCER_ID_BYTES = 256;

const DEFAULT_INTEGRATION = `restate-integration-client-ts/${pkg.version}`;

const encoder = new TextEncoder();

/**
 * Creates a client for the Restate ingestion API, the API to turn any source of events into
 * Restate invocations.
 *
 * ```ts
 * const client = connect({ url: "http://localhost:8080" });
 * const producer = client.producer({
 *   defaults: { service: "Orders", handler: "ingest" },
 * });
 * for (const order of orders) {
 *   await producer.send({ key: order.id, body: JSON.stringify(order) });
 * }
 * await producer.close();
 * await client.close();
 * ```
 *
 * @experimental
 */
export function connect(opts: IntegrationClientOptions): IntegrationClient {
  let transport = opts.transport;
  let sessionManager: Http2SessionManager | undefined;
  if (transport === undefined) {
    const url = parseIngressUrl(opts.url);
    sessionManager = new Http2SessionManager(url);
    transport = createGrpcTransport({ baseUrl: url.href, sessionManager });
  }
  const authToken = opts.authToken?.trim();
  return new IntegrationClientImpl(
    createClient(IngestionSvc, transport),
    authToken ? { authorization: `Bearer ${authToken}` } : undefined,
    truncateUtf8(
      opts.integration !== undefined
        ? `${opts.integration.name}/${opts.integration.version}`
        : DEFAULT_INTEGRATION,
      MAX_INTEGRATION_BYTES
    ),
    sessionManager
  );
}

class IntegrationClientImpl implements IntegrationClient {
  readonly #rpc: Client<typeof IngestionSvc>;
  readonly #headers: Record<string, string> | undefined;
  readonly #integration: string;
  readonly #sessionManager: Http2SessionManager | undefined;
  #closed = false;

  constructor(
    rpc: Client<typeof IngestionSvc>,
    headers: Record<string, string> | undefined,
    integration: string,
    sessionManager: Http2SessionManager | undefined
  ) {
    this.#rpc = rpc;
    this.#headers = headers;
    this.#integration = integration;
    this.#sessionManager = sessionManager;
  }

  producer(opts: ProducerOptions = {}): Producer {
    return this.#newProducer<Invocation>("", false, opts);
  }

  exactlyOnceProducer(
    producerId: string,
    opts: ProducerOptions = {}
  ): ExactlyOnceProducer {
    if (typeof producerId !== "string" || producerId.trim() === "") {
      throw new TypeError("producerId must be a non-empty string");
    }
    if (encoder.encode(producerId).byteLength > MAX_PRODUCER_ID_BYTES) {
      throw new RangeError(
        `producerId must be at most ${MAX_PRODUCER_ID_BYTES} bytes`
      );
    }
    return this.#newProducer<ExactlyOnceInvocation>(producerId, true, opts);
  }

  close(): Promise<void> {
    this.#closed = true;
    this.#sessionManager?.abort();
    return Promise.resolve();
  }

  #newProducer<R extends Invocation>(
    producerId: string,
    exactlyOnce: boolean,
    options: ProducerOptions
  ): ProducerImpl<R> {
    if (this.#closed) {
      throw new Error("The integration client is closed");
    }
    return new ProducerImpl<R>({
      rpc: this.#rpc,
      headers: this.#headers,
      integration: this.#integration,
      producerId,
      exactlyOnce,
      options,
    });
  }
}

function parseIngressUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch (e) {
    throw new TypeError(`The ingress url is not a valid URL: '${raw}'`, {
      cause: e,
    });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError(
      `The ingress url must use the http or https scheme, got '${raw}'`
    );
  }
  return url;
}

/** Truncates to at most `maxBytes` of UTF-8, without splitting a character. */
function truncateUtf8(value: string, maxBytes: number): string {
  const { read } = encoder.encodeInto(value, new Uint8Array(maxBytes));
  return value.slice(0, read);
}
