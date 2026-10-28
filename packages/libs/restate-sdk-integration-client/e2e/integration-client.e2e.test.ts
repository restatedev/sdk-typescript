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

// Integration client against a real Restate server: a port of the Java SDK's
// IntegrationClientIntegrationTest. Records add their value to a Virtual Object counter, and each
// test checks the counter to see which records became invocations.
//
// The ingestion API is not in a released Restate image yet: the tests default to
// ghcr.io/restatedev/restate:main, override with RESTATE_CONTAINER_IMAGE.

import { randomUUID } from "node:crypto";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as restate from "@restatedev/restate-sdk";
import * as clients from "@restatedev/restate-sdk-clients";
import { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { GenericContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  connect,
  IntegrationClientError,
  type Invocation,
  type InvocationDefaults,
} from "../src/index.js";

const counter = restate.object({
  name: "IntegrationClientCounter",
  handlers: {
    add: async (ctx: restate.ObjectContext, value: number) => {
      const count = (await ctx.get<number>("count")) ?? 0;
      ctx.set("count", count + value);
    },
    // Exclusive on purpose: it runs after the add invocations already enqueued for the key.
    get: async (ctx: restate.ObjectContext): Promise<number> =>
      (await ctx.get<number>("count")) ?? 0,
  },
});

const DEFAULT_BUFFER_BYTES = 32 * 1024 * 1024;

let env: RestateTestEnvironment;
let ingress: clients.Ingress;

beforeAll(async () => {
  env = await RestateTestEnvironment.start(
    { services: [counter] },
    () =>
      new GenericContainer(
        process.env.RESTATE_CONTAINER_IMAGE ?? "ghcr.io/restatedev/restate:main"
      )
  );
  ingress = clients.connect({ url: env.baseUrl() });
});

afterAll(async () => {
  await env?.stop();
});

function counterDefaults(key: string): InvocationDefaults {
  return {
    service: "IntegrationClientCounter",
    handler: "add",
    key,
    headers: { "content-type": "application/json" },
  };
}

async function counterValue(key: string): Promise<number> {
  return await ingress.objectClient(counter, key).get();
}

describe.each([0, DEFAULT_BUFFER_BYTES])("bufferBytes %d", (bufferBytes) => {
  async function sendExactlyOnce(
    producerId: string,
    key: string,
    ...records: [offset: number, value: number][]
  ): Promise<void> {
    const client = connect({ url: env.baseUrl() });
    const commits: number[] = [];
    try {
      const producer = client.exactlyOnceProducer(producerId, {
        defaults: counterDefaults(key),
        bufferBytes,
        onCommitted: (offset) => commits.push(offset),
      });
      for (const [offset, value] of records) {
        await producer.send({ offset, body: JSON.stringify(value) });
      }
      const lastOffset = records[records.length - 1]![0];
      expect(await producer.flush()).toBe(lastOffset);
      expect(commits.at(-1)).toBe(lastOffset);
      await producer.close();
    } finally {
      await client.close();
    }
  }

  async function sendAtLeastOnce(key: string, value: number): Promise<void> {
    const client = connect({ url: env.baseUrl() });
    try {
      const producer = client.producer({
        defaults: counterDefaults(key),
        bufferBytes,
      });
      expect(
        await producer.send(
          { body: JSON.stringify(value) },
          { waitCommitted: true }
        )
      ).toBe(0);
      await producer.close();
    } finally {
      await client.close();
    }
  }

  test("producer delivers and acknowledges", async () => {
    const key = randomUUID();
    const client = connect({ url: env.baseUrl() });
    const commits: number[] = [];
    try {
      const producer = client.producer({
        defaults: counterDefaults(key),
        bufferBytes,
        onCommitted: (offset) => commits.push(offset),
      });
      expect(await producer.send({ body: "1" }, { waitCommitted: true })).toBe(
        0
      );
      expect(commits).toEqual([0]);
      await producer.close();
    } finally {
      await client.close();
    }

    expect(await counterValue(key)).toBe(1);
  });

  test("exactly-once producer deduplicates across streams", async () => {
    const key = randomUUID();
    const producerId = `integration-test/${randomUUID()}`;

    await sendExactlyOnce(producerId, key, [0, 1]);
    await sendExactlyOnce(producerId, key, [0, 100]);

    expect(await counterValue(key)).toBe(1);
  });

  test("exactly-once producer replays the committed prefix and accepts new offsets", async () => {
    const key = randomUUID();
    const producerId = `integration-test/${randomUUID()}`;

    await sendExactlyOnce(producerId, key, [0, 1], [1, 10]);
    await sendExactlyOnce(producerId, key, [0, 100], [1, 1_000], [2, 10_000]);

    expect(await counterValue(key)).toBe(10_011);
  });

  test("exactly-once producer drops offsets below the committed watermark", async () => {
    const key = randomUUID();
    const producerId = `integration-test/${randomUUID()}`;

    await sendExactlyOnce(producerId, key, [10, 1]);
    await sendExactlyOnce(producerId, key, [0, 100], [9, 1_000], [11, 10]);

    expect(await counterValue(key)).toBe(11);
  });

  test("exactly-once deduplication is scoped by producer id", async () => {
    const key = randomUUID();

    await sendExactlyOnce(`integration-test/${randomUUID()}`, key, [0, 1]);
    await sendExactlyOnce(`integration-test/${randomUUID()}`, key, [0, 10]);

    expect(await counterValue(key)).toBe(11);
  });

  test("at-least-once producer does not deduplicate across streams", async () => {
    const key = randomUUID();

    await sendAtLeastOnce(key, 1);
    await sendAtLeastOnce(key, 10);

    expect(await counterValue(key)).toBe(11);
  });

  test("writable pipes a source through Node's pipeline", async () => {
    const key = randomUUID();
    const client = connect({ url: env.baseUrl() });
    try {
      const producer = client.producer({
        defaults: counterDefaults(key),
        bufferBytes,
      });
      await pipeline(
        Readable.from(Array.from({ length: 100 }, (_, i) => i)),
        async function* (values: AsyncIterable<number>) {
          for await (const value of values) {
            yield { body: JSON.stringify(value) };
          }
        },
        // @types/node does not type pipeline() with a WritableStream destination.
        Writable.fromWeb(producer.writable, { objectMode: true })
      );
    } finally {
      await client.close();
    }

    expect(await counterValue(key)).toBe(4_950);
  });

  async function sendExpectingError(
    defaults: InvocationDefaults,
    record: Invocation
  ): Promise<IntegrationClientError> {
    const client = connect({ url: env.baseUrl() });
    try {
      const producer = client.producer({ defaults, bufferBytes });
      const error: unknown = await producer
        .send(record, { waitCommitted: true })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(IntegrationClientError);
      return error as IntegrationClientError;
    } finally {
      await client.close();
    }
  }

  test("an unknown handler in the defaults fails the stream with not_found", async () => {
    // Restate validates the defaults with the Start frame: the error is stream-scoped.
    const error = await sendExpectingError(
      { ...counterDefaults(randomUUID()), handler: "doesNotExist" },
      { body: "1" }
    );
    expect(error.kind).toBe("not_found");
    expect(error.offset).toBeUndefined();
  });

  test("an unknown handler on a record fails with not_found and the record offset", async () => {
    const error = await sendExpectingError(
      { ...counterDefaults(randomUUID()), handler: undefined },
      { handler: "doesNotExist", body: "1" }
    );
    expect(error.kind).toBe("not_found");
    expect(error.offset).toBe(0);
  });

  test("a Virtual Object record without a key fails with bad_request and the record offset", async () => {
    const error = await sendExpectingError(
      { ...counterDefaults(randomUUID()), key: undefined },
      { body: "1" }
    );
    expect(error.kind).toBe("bad_request");
    expect(error.offset).toBe(0);
  });
});
