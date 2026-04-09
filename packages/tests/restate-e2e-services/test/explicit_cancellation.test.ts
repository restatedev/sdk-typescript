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
import { getAdminUrl, ingressClient } from "./utils.js";
import type { ExplicitCancellation } from "../src/explicit_cancellation.js";

const ExplicitCancellation: ExplicitCancellation = {
  name: "ExplicitCancellation",
};

function idempotentSend() {
  return rpc.sendOpts({ idempotencyKey: randomUUID() });
}

async function cancelInvocation(invocationId: string): Promise<void> {
  const res = await fetch(
    `${getAdminUrl()}/invocations/${invocationId}/cancel`,
    { method: "PATCH" }
  );
  if (res.ok) return;
  throw new Error(
    `Failed to cancel invocation ${invocationId}: ${res.status} ${await res.text()}`
  );
}

describe("ExplicitCancellation", () => {
  const ingress = ingressClient();

  it("raceAgainstCancellation: cancellation wins the race", async () => {
    const send = await ingress
      .serviceSendClient(ExplicitCancellation)
      .raceAgainstCancellation(idempotentSend());

    await cancelInvocation(send.invocationId);

    expect(ingress.result(send)).rejects.toThrow("Cancelled");
  }, 30_000);

  it("doubleCancellation: catches cancellation, does cleanup, returns normally", async () => {
    const send = await ingress
      .serviceSendClient(ExplicitCancellation)
      .doubleCancellation(idempotentSend());

    await cancelInvocation(send.invocationId);

    const result = await ingress.result(send);
    expect(result).toBe("cleanup-done");
  }, 30_000);

  it("abortControllerInRun: cancellation aborts multiple ctx.run via AbortController", async () => {
    const count = 5;
    const send = await ingress
      .serviceSendClient(ExplicitCancellation)
      .abortControllerInRun(count, idempotentSend());

    await cancelInvocation(send.invocationId);

    const result = await ingress.result(send);
    const expectedRunResults = Array(count).fill("run-cancelled").join(",");
    expect(result).toBe(`controller-abort-${expectedRunResults}`);
  }, 30_000);

  it("cancelCalls: cancels all previous calls", async () => {
    const result = await ingress
      .serviceClient(ExplicitCancellation)
      .cancelCalls(3);

    expect(result).toHaveLength(3);
    // Each entry should be a valid invocation ID string
    for (const id of result) {
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
    }
  }, 30_000);

  it("cancelCalls: zero calls returns empty list", async () => {
    const result = await ingress
      .serviceClient(ExplicitCancellation)
      .cancelCalls(0);

    expect(result).toEqual([]);
  }, 30_000);

  it("cancelCallsTwoBatches: each batch cancels only its own calls", async () => {
    const [firstBatch, secondBatch] = await ingress
      .serviceClient(ExplicitCancellation)
      .cancelCallsTwoBatches({ first: 2, second: 3 });

    expect(firstBatch).toHaveLength(2);
    expect(secondBatch).toHaveLength(3);

    // Batches should have distinct invocation IDs
    const allIds = [...firstBatch, ...secondBatch];
    expect(new Set(allIds).size).toBe(5);
  }, 30_000);
});
