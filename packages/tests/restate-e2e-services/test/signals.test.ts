// Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
//
// This file is part of the Restate e2e tests,
// which are released under the MIT license.
//
// You can find a copy of the license in file LICENSE in the root
// directory of this repository or package, or at
// https://github.com/restatedev/e2e/blob/main/LICENSE

import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { rpc } from "@restatedev/restate-sdk-clients";
import { ingressClient } from "./utils.js";
import type { SignalTest } from "../src/signals.js";

const SignalTest: SignalTest = { name: "SignalTest" };

function idempotentSend<I = unknown>() {
  return rpc.sendOpts<I>({ idempotencyKey: randomUUID() });
}

describe("SignalTest", () => {
  const ingress = ingressClient();

  // ---------------------------------------------------------------------------
  // Basic signal resolve
  // ---------------------------------------------------------------------------
  it("resolve: signal value is returned to the waiting handler", async () => {
    const send = await ingress
      .serviceSendClient(SignalTest)
      .waitForSignal("mySignal", idempotentSend());

    await ingress.serviceClient(SignalTest).resolveSignal({
      invocationId: send.invocationId,
      name: "mySignal",
      value: "hello",
    });

    const result = await ingress.result(send);
    expect(result).toBe("hello");
  }, 30_000);

  // ---------------------------------------------------------------------------
  // Basic signal reject
  // ---------------------------------------------------------------------------
  it("reject: signal rejection propagates as terminal error", async () => {
    const send = await ingress
      .serviceSendClient(SignalTest)
      .waitForSignal("mySignal", idempotentSend());

    await ingress.serviceClient(SignalTest).rejectSignal({
      invocationId: send.invocationId,
      name: "mySignal",
      reason: "boom",
    });

    await expect(ingress.result(send)).rejects.toThrow("boom");
  }, 30_000);

  // ---------------------------------------------------------------------------
  // Typed/structured signal payload
  // ---------------------------------------------------------------------------
  it("structured payload: signal carries complex value", async () => {
    const send = await ingress
      .serviceSendClient(SignalTest)
      .waitForSignal("typedSignal", idempotentSend());

    await ingress.serviceClient(SignalTest).resolveSignal({
      invocationId: send.invocationId,
      name: "typedSignal",
      value: { key: "test-key", count: 42 },
    });

    const result = await ingress.result(send);
    expect(result).toEqual({ key: "test-key", count: 42 });
  }, 30_000);

  // ---------------------------------------------------------------------------
  // Multiple named signals
  // ---------------------------------------------------------------------------
  it("multiple named signals resolved independently", async () => {
    const send = await ingress
      .serviceSendClient(SignalTest)
      .waitForTwoSignals(idempotentSend());

    // Resolve in reverse order to verify names are independent
    await ingress.serviceClient(SignalTest).resolveSignal({
      invocationId: send.invocationId,
      name: "signalB",
      value: "b-value",
    });
    await ingress.serviceClient(SignalTest).resolveSignal({
      invocationId: send.invocationId,
      name: "signalA",
      value: "a-value",
    });

    const result = await ingress.result(send);
    expect(result).toEqual({ a: "a-value", b: "b-value" });
  }, 30_000);

  // ---------------------------------------------------------------------------
  // Race signal vs timeout: timeout wins
  // ---------------------------------------------------------------------------
  it("race vs timeout: timeout wins when no signal arrives", async () => {
    const result = await ingress
      .serviceClient(SignalTest)
      .raceSignalVsTimeout(1);

    expect(result).toBe("timeout");
  }, 30_000);

  // ---------------------------------------------------------------------------
  // Race signal vs timeout: signal wins
  // ---------------------------------------------------------------------------
  it("race vs timeout: signal wins when resolved before timeout", async () => {
    // Use a long timeout so we can resolve the signal first
    const send = await ingress
      .serviceSendClient(SignalTest)
      .raceSignalVsTimeout(60_000, idempotentSend());

    await ingress.serviceClient(SignalTest).resolveSignal({
      invocationId: send.invocationId,
      name: "mySignal",
      value: "fast",
    });

    const result = await ingress.result(send);
    expect(result).toBe("fast");
  }, 30_000);

  // ---------------------------------------------------------------------------
  // Signal stream: append + end
  // ---------------------------------------------------------------------------
  it("signal stream: collect values until end-of-stream", async () => {
    const send = await ingress
      .serviceSendClient(SignalTest)
      .readStream(idempotentSend());

    await ingress.serviceClient(SignalTest).appendToStream({
      invocationId: send.invocationId,
      values: ["alpha", "beta", "gamma"],
    });

    await ingress.serviceClient(SignalTest).endStream({
      invocationId: send.invocationId,
    });

    const result = await ingress.result(send);
    expect(result).toEqual(["alpha", "beta", "gamma"]);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // Signal stream: multiple append batches
  // ---------------------------------------------------------------------------
  it("signal stream: multiple batches then end", async () => {
    const send = await ingress
      .serviceSendClient(SignalTest)
      .readStream(idempotentSend());

    await ingress.serviceClient(SignalTest).appendToStream({
      invocationId: send.invocationId,
      values: ["a", "b"],
    });

    await ingress.serviceClient(SignalTest).appendToStream({
      invocationId: send.invocationId,
      values: ["c"],
    });

    await ingress.serviceClient(SignalTest).endStream({
      invocationId: send.invocationId,
    });

    const result = await ingress.result(send);
    expect(result).toEqual(["a", "b", "c"]);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // Signal stream: empty stream (immediate end)
  // ---------------------------------------------------------------------------
  it("signal stream: empty stream returns empty array", async () => {
    const send = await ingress
      .serviceSendClient(SignalTest)
      .readStream(idempotentSend());

    await ingress.serviceClient(SignalTest).endStream({
      invocationId: send.invocationId,
    });

    const result = await ingress.result(send);
    expect(result).toEqual([]);
  }, 30_000);
});
