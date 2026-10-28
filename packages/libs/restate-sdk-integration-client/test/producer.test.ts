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

import { toBinary } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, test, vi } from "vitest";
import {
  ErrorKind,
  IngestionInvocationSchema,
} from "../src/generated/dev/restate/ingress/ingestion/v1/ingestion_svc_pb.js";
import { IntegrationClientError, type Invocation } from "../src/index.js";
import { toProtoInvocation } from "../src/proto.js";
import { FakeIngestion, isPending } from "./fake-ingestion.js";

// About 10 KB serialized: the initial 32 KiB window lets four of them through (the fourth takes
// the window negative), then the client must wait for a WindowUpdate.
const bigRecord = (): Invocation => ({ body: "x".repeat(10_000) });

function serializedSize(record: Invocation, offset: number): number {
  return toBinary(IngestionInvocationSchema, toProtoInvocation(record, offset))
    .byteLength;
}

const decoder = new TextDecoder();

function rangeOf(length: number): number[] {
  return Array.from({ length }, (_, i) => i);
}

describe("offsets", () => {
  test("at-least-once producer assigns offsets 0, 1, 2… in send order", async () => {
    const fake = new FakeIngestion();
    const producer = fake.client().producer();

    expect(await producer.send({ body: "a" })).toBe(0);
    expect(await producer.send({ body: "b" })).toBe(1);
    expect(await producer.send({ body: "c" })).toBe(2);
    await vi.waitFor(() => expect(fake.offsets).toEqual([0, 1, 2]));
  });

  test("concurrent sends keep call order", async () => {
    const fake = new FakeIngestion();
    const producer = fake.client().producer();

    const offsets = await Promise.all(
      ["a", "b", "c"].map((body) => producer.send({ body }))
    );
    expect(offsets).toEqual([0, 1, 2]);
    await vi.waitFor(() =>
      expect(fake.invocations.map((i) => decoder.decode(i.payload))).toEqual([
        "a",
        "b",
        "c",
      ])
    );
  });

  test("exactly-once producer rejects invalid offsets without consuming them", async () => {
    const fake = new FakeIngestion();
    const producer = fake.client().exactlyOnceProducer("producer");

    expect(await producer.send({ offset: 5, body: "a" })).toBe(5);
    for (const offset of [5, 3, -1, 1.5, Number.MAX_SAFE_INTEGER + 2]) {
      await expect(producer.send({ offset })).rejects.toThrow(RangeError);
    }
    expect(await producer.send({ offset: 6, body: "b" })).toBe(6);
    await vi.waitFor(() => expect(fake.offsets).toEqual([5, 6]));
  });

  test("invocation fields map to the wire", async () => {
    const fake = new FakeIngestion();
    const producer = fake.client().producer();
    const invokeAt = new Date("2026-10-28T10:00:00.000Z");

    await producer.send({
      service: "Orders",
      handler: "ingest",
      key: "order-1",
      scope: "tenant-a",
      limitKey: "limit",
      headers: { "content-type": "application/json" },
      idempotencyKey: "idempotency",
      invokeAt,
      traceparent: "00-trace-span-01",
      tracestate: "vendor=value",
      body: "héllo",
    });
    await producer.send({ body: new Uint8Array([1, 2, 3]) });
    await producer.send({});

    await vi.waitFor(() => expect(fake.invocations).toHaveLength(3));
    const [full, bytes, empty] = fake.invocations;
    expect(full).toMatchObject({
      offset: 0n,
      service: "Orders",
      handler: "ingest",
      key: "order-1",
      scope: "tenant-a",
      limitKey: "limit",
      additionalHeaders: { "content-type": "application/json" },
      idempotencyKey: "idempotency",
      invokeTimeTsMs: BigInt(invokeAt.getTime()),
      traceparent: "00-trace-span-01",
      tracestate: "vendor=value",
    });
    expect(decoder.decode(full!.payload)).toBe("héllo");
    expect(bytes!.payload).toEqual(new Uint8Array([1, 2, 3]));
    expect(empty).toMatchObject({ offset: 2n, additionalHeaders: {} });
    expect(empty!.service).toBeUndefined();
    expect(empty!.invokeTimeTsMs).toBeUndefined();
    expect(empty!.payload).toHaveLength(0);
  });
});

describe("flow control", () => {
  test("sends on the assumed initial window without waiting for a grant", async () => {
    const fake = new FakeIngestion();
    const producer = fake.client().producer();

    await producer.send({ body: "a" });
    await vi.waitFor(() => expect(fake.invocations).toHaveLength(1));
  });

  test("stops writing when the window is exhausted and resumes on WindowUpdate", async () => {
    const fake = new FakeIngestion();
    const producer = fake.client().producer();

    for (let i = 0; i < 6; i++) {
      await producer.send(bigRecord());
    }
    await vi.waitFor(() => expect(fake.invocations).toHaveLength(4));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fake.invocations).toHaveLength(4);

    fake.grantWindow(10_000);
    await vi.waitFor(() => expect(fake.invocations).toHaveLength(5));
    fake.grantWindow(20_000);
    await vi.waitFor(() => expect(fake.invocations).toHaveLength(6));
  });

  test("send waits while the buffer is full, and sends are admitted in order", async () => {
    const fake = new FakeIngestion();
    const recordSize = serializedSize(bigRecord(), 1);
    const producer = fake
      .client()
      .producer({ bufferBytes: 2 * recordSize + 100 });

    // Four records go out on the initial window, the next two fill the buffer.
    for (let i = 0; i < 6; i++) {
      await producer.send(bigRecord());
    }
    await vi.waitFor(() => expect(fake.invocations).toHaveLength(4));

    const seventh = producer.send(bigRecord());
    const eighth = producer.send(bigRecord());
    expect(await isPending(seventh)).toBe(true);

    // One record leaves the buffer: room for the seventh, not yet for the eighth.
    fake.grantWindow(10_000);
    expect(await seventh).toBe(6);
    expect(await isPending(eighth)).toBe(true);

    fake.grantWindow(20_000);
    expect(await eighth).toBe(7);
  });

  test("a record of exactly bufferBytes is accepted, a larger one is rejected without consuming its offset", async () => {
    const record = { body: "x".repeat(100) };
    const size = serializedSize(record, 0);

    const exact = new FakeIngestion().client().producer({ bufferBytes: size });
    expect(await exact.send(record)).toBe(0);

    const fake = new FakeIngestion();
    const tooSmall = fake.client().producer({ bufferBytes: size - 1 });
    await expect(tooSmall.send(record)).rejects.toThrow(RangeError);
    expect(await tooSmall.send({ body: "small" })).toBe(0);
    await vi.waitFor(() => expect(fake.offsets).toEqual([0]));
  });

  test("without a buffer, send resolves only once the record is written to the stream", async () => {
    const fake = new FakeIngestion();
    const producer = fake.client().producer({ bufferBytes: 0 });

    for (let i = 0; i < 4; i++) {
      await producer.send(bigRecord());
    }
    const fifth = producer.send(bigRecord());
    expect(await isPending(fifth)).toBe(true);
    expect(fake.invocations).toHaveLength(4);

    fake.grantWindow(10_000);
    expect(await fifth).toBe(4);
    await vi.waitFor(() => expect(fake.invocations).toHaveLength(5));
  });
});

describe("commits", () => {
  test("waitCommitted resolves once the watermark covers the record", async () => {
    const fake = new FakeIngestion();
    const producer = fake.client().producer();

    const sent = producer.send({ body: "a" }, { waitCommitted: true });
    await vi.waitFor(() => expect(fake.invocations).toHaveLength(1));
    expect(await isPending(sent)).toBe(true);

    fake.ack(0);
    expect(await sent).toBe(0);
  });

  test("flush resolves with the watermark once everything sent is committed", async () => {
    const fake = new FakeIngestion();
    const producer = fake.client().producer();
    expect(await producer.flush()).toBe(-1);

    await producer.send({ body: "a" });
    await producer.send({ body: "b" });
    const flushed = producer.flush();
    fake.ack(0);
    expect(await isPending(flushed)).toBe(true);

    fake.ack(1);
    expect(await flushed).toBe(1);
  });

  test("onCommitted is called only when the watermark advances", async () => {
    const fake = new FakeIngestion();
    const commits: number[] = [];
    const producer = fake
      .client()
      .producer({ onCommitted: (offset) => commits.push(offset) });

    for (const body of ["a", "b", "c"]) {
      await producer.send({ body });
    }
    fake.ack(1);
    fake.ack(1);
    fake.ack(0);
    fake.ack(2);
    await vi.waitFor(() => expect(commits).toEqual([1, 2]));
  });

  test("an offset below the known watermark is already committed", async () => {
    const fake = new FakeIngestion();
    const producer = fake.client().exactlyOnceProducer("producer");

    await producer.send({ offset: 1 });
    fake.ack(10);
    expect(await producer.flush()).toBe(10);
    expect(await producer.send({ offset: 7 }, { waitCommitted: true })).toBe(7);
  });

  test("an onCommitted callback that throws aborts the producer", async () => {
    const fake = new FakeIngestion();
    const boom = new Error("boom");
    const producer = fake.client().producer({
      onCommitted: () => {
        throw boom;
      },
    });

    await producer.send({ body: "a" });
    const second = producer.send({ body: "b" }, { waitCommitted: true });
    fake.ack(0);
    await expect(second).rejects.toBe(boom);
    await expect(producer.send({})).rejects.toBe(boom);
  });
});

describe("errors", () => {
  test("a record-scoped error carries the offset, after completing the acknowledged records", async () => {
    const fake = new FakeIngestion();
    const producer = fake.client().producer();

    const first = producer.send({ body: "a" }, { waitCommitted: true });
    const second = producer.send({ body: "b" }, { waitCommitted: true });
    await vi.waitFor(() => expect(fake.invocations).toHaveLength(2));
    fake.error(ErrorKind.BAD_REQUEST, "missing key", {
      offset: 1,
      lastCommitted: 0,
    });

    expect(await first).toBe(0);
    const error: unknown = await second.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IntegrationClientError);
    expect(error).toMatchObject({
      kind: "bad_request",
      offset: 1,
      message: "[offset=1] missing key",
    });
    // Terminal: every later operation fails with the same error.
    await expect(producer.send({})).rejects.toBe(error);
    await expect(producer.flush()).rejects.toBe(error);
    await expect(producer.close()).rejects.toBe(error);
  });

  test.each([
    [ErrorKind.SHUTTING_DOWN, "shutting_down"],
    [ErrorKind.GO_AWAY, "go_away"],
    [ErrorKind.NOT_FOUND, "not_found"],
    [ErrorKind.BAD_REQUEST, "bad_request"],
    [ErrorKind.UNAVAILABLE, "unavailable"],
    [ErrorKind.UNKNOWN, "unknown"],
  ])(
    "a stream-scoped error of kind %s has no offset",
    async (kind, expected) => {
      const fake = new FakeIngestion();
      const producer = fake.client().producer();

      const sent = producer.send({}, { waitCommitted: true });
      fake.error(kind, "nope");

      const error: unknown = await sent.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(IntegrationClientError);
      expect(error).toMatchObject({ kind: expected, message: "nope" });
      expect((error as IntegrationClientError).offset).toBeUndefined();
    }
  );

  test("the server ending the stream unexpectedly fails the producer", async () => {
    const fake = new FakeIngestion();
    const producer = fake.client().producer();

    const sent = producer.send({}, { waitCommitted: true });
    fake.end();
    await expect(sent).rejects.toMatchObject({ kind: "unknown" });
  });

  test("a transport failure fails the producer and keeps the cause", async () => {
    const fake = new FakeIngestion();
    const producer = fake.client().producer();

    const sent = producer.send({}, { waitCommitted: true });
    fake.failCall(new ConnectError("connection reset", Code.Unavailable));

    const error: unknown = await sent.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IntegrationClientError);
    expect((error as IntegrationClientError).kind).toBe("unknown");
    expect((error as IntegrationClientError).cause).toBeInstanceOf(
      ConnectError
    );
  });

  test("flush still reports the watermark after a failure if everything was committed", async () => {
    const fake = new FakeIngestion();
    const producer = fake.client().producer();

    await producer.send({ body: "a" });
    fake.ack(0);
    expect(await producer.flush()).toBe(0);
    fake.end();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(producer.send({})).rejects.toBeInstanceOf(
      IntegrationClientError
    );
    expect(await producer.flush()).toBe(0);
  });
});

describe("lifecycle", () => {
  test("close flushes, then half-closes the request stream", async () => {
    const fake = new FakeIngestion();
    const producer = fake.client().producer();

    await producer.send({ body: "a" });
    await producer.send({ body: "b" });
    const closed = producer.close();
    await vi.waitFor(() => expect(fake.invocations).toHaveLength(2));
    expect(await isPending(closed)).toBe(true);
    expect(fake.requestStreamEnded).toBe(false);

    fake.ack(1);
    await closed;
    expect(fake.requestStreamEnded).toBe(true);
    await expect(producer.send({})).rejects.toThrow("closed");
  });

  test("abort rejects every pending operation with the reason", async () => {
    const fake = new FakeIngestion();
    const producer = fake.client().producer();

    const sent = producer.send({ body: "a" }, { waitCommitted: true });
    const reason = new Error("stop");
    producer.abort(reason);

    await expect(sent).rejects.toBe(reason);
    await expect(producer.flush()).rejects.toBe(reason);
    await expect(producer.send({})).rejects.toBe(reason);
    await expect(producer.close()).rejects.toBe(reason);
  });

  test("abort without a reason fails with an IntegrationClientError", async () => {
    const fake = new FakeIngestion();
    const producer = fake.client().producer();

    producer.abort();
    await expect(producer.send({})).rejects.toMatchObject({
      name: "IntegrationClientError",
      kind: "unknown",
    });
  });
});

describe("writable", () => {
  test("pipeTo sends every record in order, and closing commits them", async () => {
    const fake = new FakeIngestion({ autoAck: true });
    const commits: number[] = [];
    const producer = fake
      .client()
      .producer({ onCommitted: (offset) => commits.push(offset) });

    const source = new ReadableStream<Invocation>({
      start(controller) {
        for (const i of rangeOf(50)) {
          controller.enqueue({ body: String(i) });
        }
        controller.close();
      },
    });
    await source.pipeTo(producer.writable);

    expect(fake.invocations.map((i) => decoder.decode(i.payload))).toEqual(
      rangeOf(50).map(String)
    );
    expect(commits.at(-1)).toBe(49);
    expect(fake.requestStreamEnded).toBe(true);
  });

  test("a producer failure rejects pipeTo", async () => {
    const fake = new FakeIngestion();
    const producer = fake.client().producer({ bufferBytes: 1024 });

    const endless = new ReadableStream<Invocation>({
      pull(controller) {
        controller.enqueue({ body: "x" });
      },
    });
    const piping = endless.pipeTo(producer.writable);
    await vi.waitFor(() => expect(fake.invocations.length).toBeGreaterThan(0));

    fake.error(ErrorKind.GO_AWAY, "go away");
    await expect(piping).rejects.toMatchObject({ kind: "go_away" });
  });

  test("a failing source aborts the producer", async () => {
    const fake = new FakeIngestion();
    const producer = fake.client().producer();
    const sourceError = new Error("source failed");

    const source = new ReadableStream<Invocation>({
      start(controller) {
        controller.enqueue({ body: "a" });
        controller.error(sourceError);
      },
    });
    await expect(source.pipeTo(producer.writable)).rejects.toBe(sourceError);
    await expect(producer.send({})).rejects.toBe(sourceError);
  });
});
