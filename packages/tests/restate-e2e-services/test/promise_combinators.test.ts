// Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
//
// This file is part of the Restate e2e tests,
// which are released under the MIT license.
//
// You can find a copy of the license in file LICENSE in the root
// directory of this repository or package, or at
// https://github.com/restatedev/e2e/blob/main/LICENSE

import { describe, it, expect } from "vitest";
import { ingressClient } from "./utils.js";
import type { PromiseCombinators } from "../src/promise_combinators.js";

const PromiseCombinators: PromiseCombinators = {
  name: "PromiseCombinators",
};

describe("PromiseCombinators", () => {
  const ingress = ingressClient();
  const client = ingress.serviceClient(PromiseCombinators);

  // --- RestatePromise.resolve ---

  it("resolve returns the value", async () => {
    const result = await client.resolveWithValue("hello");
    expect(result).toBe("hello");
  });

  // --- RestatePromise.reject ---

  it("reject throws TerminalError", async () => {
    await expect(client.rejectWithTerminalError("boom")).rejects.toThrow(
      "boom"
    );
  });

  // --- RestatePromise.all with resolved promises ---

  it("all with resolved promises returns all values", async () => {
    const result = await client.allWithResolvedPromises(["a", "b", "c"]);
    expect(result).toEqual(["a", "b", "c"]);
  });

  it("all with one rejected propagates the rejection", async () => {
    await expect(
      client.allWithOneRejected({
        values: ["a", "b", "c"],
        rejectIndex: 1,
        errorMessage: "fail at 1",
      })
    ).rejects.toThrow("fail at 1");
  });

  // --- RestatePromise.race with resolved promises ---

  it("race with resolved promises returns first value", async () => {
    const result = await client.raceWithResolvedPromises(["first", "second"]);
    expect(result).toBe("first");
  });

  // --- RestatePromise.any ---

  it("any with resolved promises returns first fulfilled", async () => {
    const result = await client.anyWithResolvedPromises(["x", "y"]);
    expect(result).toBe("x");
  });

  // TODO: Skipped - AggregateError from Promise.any is not converted to TerminalError by the SDK.
  // See: https://github.com/restatedev/sdk-typescript/issues/672
  it.skip("any with all rejected throws", async () => {
    await expect(client.anyWithAllRejected(["err1", "err2"])).rejects.toThrow();
  });

  // --- RestatePromise.allSettled mixed ---

  it("allSettled with mixed resolved and rejected", async () => {
    const result = await client.allSettledMixed({
      values: ["ok", "fail", "ok2"],
      rejectIndices: [1],
    });

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ status: "fulfilled", value: "ok" });
    expect(result[1]).toMatchObject({ status: "rejected" });
    expect(result[2]).toEqual({ status: "fulfilled", value: "ok2" });
  });

  // --- Empty array combinators ---

  it("all with empty array returns empty array", async () => {
    const result = await client.allEmpty();
    expect(result).toEqual([]);
  });

  it("allSettled with empty array returns empty array", async () => {
    const result = await client.allSettledEmpty();
    expect(result).toEqual([]);
  });

  // --- Mixed context promises + resolved/rejected ---

  it("all mixed with sleep and resolved promise", async () => {
    const result = await client.allMixedWithSleep({
      sleepMs: 100,
      resolvedValue: "instant",
    });
    expect(result).toEqual(["slept", "instant"]);
  });

  it("race mixed: resolved promise wins over sleep", async () => {
    const result = await client.raceMixedWithSleep({
      sleepMs: 60000,
      resolvedValue: "instant",
    });
    expect(result).toBe("instant");
  });

  // --- orTimeout on resolved/pending ---

  it("resolve().orTimeout() returns the value", async () => {
    const result = await client.resolveOrTimeout("hello");
    expect(result).toBe("hello");
  });

  it("race([]).orTimeout() rejects with TimeoutError", async () => {
    await expect(client.raceEmptyOrTimeout()).rejects.toThrow();
  });

  it("race([]).orTimeout().map() catches the TimeoutError", async () => {
    const result = await client.raceEmptyOrTimeoutMapped();
    expect(result).toBe("timeout");
  });

  it("map with sync ctx side effect produces expected mapped value deterministically", async () => {
    const result = await client.verifyConstPromiseMapDeterministic("hello");
    expect(result).toBe("hello");
  });
});
