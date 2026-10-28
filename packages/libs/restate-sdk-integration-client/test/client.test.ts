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

import { describe, expect, test, vi } from "vitest";
import pkg from "../package.json" with { type: "json" };
import { DeduplicationMode } from "../src/generated/dev/restate/ingress/ingestion/v1/ingestion_svc_pb.js";
import { connect } from "../src/index.js";
import { FakeIngestion } from "./fake-ingestion.js";

describe("handshake", () => {
  test("producer opens the stream with an at-least-once Start frame", async () => {
    const fake = new FakeIngestion();
    fake.client().producer();

    await vi.waitFor(() => expect(fake.start).toBeDefined());
    expect(fake.start!.producerId).toBe("");
    expect(fake.start!.deduplicationMode).toBe(DeduplicationMode.DISABLED);
    expect(fake.start!.defaults).toBeUndefined();
  });

  test("exactly-once producer opens the stream with an offset-based Start frame", async () => {
    const fake = new FakeIngestion();
    const producer = fake.client().exactlyOnceProducer("orders/partition-0");

    expect(producer.producerId).toBe("orders/partition-0");
    await vi.waitFor(() => expect(fake.start).toBeDefined());
    expect(fake.start!.producerId).toBe("orders/partition-0");
    expect(fake.start!.deduplicationMode).toBe(DeduplicationMode.OFFSET_BASED);
  });

  test("the Start frame identifies this client by default", async () => {
    const fake = new FakeIngestion();
    fake.client().producer();

    await vi.waitFor(() => expect(fake.start).toBeDefined());
    expect(fake.start!.integration).toBe(
      `restate-integration-client-ts/${pkg.version}`
    );
  });

  test("a custom integration is truncated to 64 bytes without splitting characters", async () => {
    const fake = new FakeIngestion();
    // 62 ASCII bytes + "/" leaves one byte, not enough for the two-byte "é".
    fake
      .client({ integration: { name: "x".repeat(62), version: "é1" } })
      .producer();

    await vi.waitFor(() => expect(fake.start).toBeDefined());
    expect(fake.start!.integration).toBe(`${"x".repeat(62)}/`);
  });

  test("producer defaults are sent in the Start frame", async () => {
    const fake = new FakeIngestion();
    fake.client().producer({
      defaults: {
        service: "Orders",
        handler: "ingest",
        key: "k",
        scope: "s",
        limitKey: "l",
        headers: { "content-type": "application/json" },
      },
    });

    await vi.waitFor(() => expect(fake.start).toBeDefined());
    const defaults = fake.start!.defaults!;
    expect(defaults.service).toBe("Orders");
    expect(defaults.handler).toBe("ingest");
    expect(defaults.key).toBe("k");
    expect(defaults.scope).toBe("s");
    expect(defaults.limitKey).toBe("l");
    expect(defaults.headers).toEqual({ "content-type": "application/json" });
  });

  test.each([
    ["my-token", "Bearer my-token"],
    [undefined, null],
    ["  ", null],
  ])("authToken %j is sent as %j", async (authToken, expected) => {
    const fake = new FakeIngestion();
    fake.client({ authToken }).producer();

    await vi.waitFor(() => expect(fake.requestHeaders).toBeDefined());
    expect(fake.requestHeaders!.get("authorization")).toBe(expected);
  });
});

describe("validation", () => {
  test.each(["", "   "])(
    "exactly-once producer rejects the producer id %j",
    (producerId) => {
      const fake = new FakeIngestion();
      expect(() => fake.client().exactlyOnceProducer(producerId)).toThrow(
        TypeError
      );
    }
  );

  test("exactly-once producer rejects producer ids longer than 256 bytes", () => {
    const fake = new FakeIngestion();
    expect(() => fake.client().exactlyOnceProducer("é".repeat(129))).toThrow(
      RangeError
    );
    expect(() =>
      fake.client().exactlyOnceProducer("é".repeat(128))
    ).not.toThrow();
  });

  test.each([-1, 1.5, Number.NaN])(
    "bufferBytes %d is rejected",
    (bufferBytes) => {
      const fake = new FakeIngestion();
      expect(() => fake.client().producer({ bufferBytes })).toThrow(RangeError);
    }
  );

  test.each(["not a url", "ftp://localhost:8080"])(
    "connect rejects the url %j",
    (url) => {
      expect(() => connect({ url })).toThrow(TypeError);
    }
  );

  test("a closed client refuses new producers", async () => {
    const fake = new FakeIngestion();
    const client = fake.client();
    await client.close();
    expect(() => client.producer()).toThrow("closed");
  });
});
