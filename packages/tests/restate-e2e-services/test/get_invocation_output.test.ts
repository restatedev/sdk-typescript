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
import type { GetInvocationOutputTest } from "../src/get_invocation_output.js";
import type { SignalTest } from "../src/signals.js";

const GetInvocationOutputTest: GetInvocationOutputTest = {
  name: "GetInvocationOutputTest",
};
const SignalTest: SignalTest = { name: "SignalTest" };

function idempotentSend<I = unknown>() {
  return rpc.sendOpts<I>({ idempotencyKey: randomUUID() });
}

describe("GetInvocationOutputTest", () => {
  const ingress = ingressClient();
  const client = ingress.serviceClient(GetInvocationOutputTest);
  const sendClient = ingress.serviceSendClient(GetInvocationOutputTest);

  it("running, then success once the target completes", async () => {
    const send = await sendClient.waitForSignal(idempotentSend());

    expect(await client.probe(send.invocationId)).toEqual({
      status: "running",
    });

    await ingress.serviceClient(SignalTest).resolveSignal({
      invocationId: send.invocationId,
      name: "done",
      value: "hello",
    });
    expect(await ingress.result(send)).toBe("hello");

    expect(await client.probe(send.invocationId)).toEqual({
      status: "success",
      value: "hello",
    });
  }, 30_000);

  it("failure: the target failure is returned, not thrown", async () => {
    const send = await sendClient.fail(idempotentSend());
    await expect(ingress.result(send)).rejects.toThrow("boom");

    expect(await client.probe(send.invocationId)).toEqual({
      status: "failure",
      error: { message: "boom", code: 418, metadata: { reason: "teapot" } },
    });
  }, 30_000);

  it("success with void output", async () => {
    const send = await sendClient.returnVoid(idempotentSend());
    await ingress.result(send);

    expect(await client.probe(send.invocationId)).toEqual({
      status: "success",
    });
  }, 30_000);

  it("unknown invocation: failure with 404 not found", async () => {
    // Make an invocation id that doesn't exist, by changing the last character of a real one
    const send = await sendClient.returnVoid(idempotentSend());
    await ingress.result(send);
    const id = send.invocationId;
    const unknownId = id.slice(0, -1) + (id.endsWith("a") ? "b" : "a");

    expect(await client.probe(unknownId)).toEqual({
      status: "failure",
      error: { message: "not found", code: 404, metadata: {} },
    });
  }, 30_000);
});
