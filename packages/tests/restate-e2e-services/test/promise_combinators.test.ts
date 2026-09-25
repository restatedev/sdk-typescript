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
import { TerminalError } from "@restatedev/restate-sdk";
import { getAdminUrl, getIngressUrl, ingressClient } from "./utils.js";
import {
  expectTerminalFailure,
  RETRY_TEST_TIMEOUT_MS,
  SEND_TIMEOUT_MS,
  TERMINAL_TEST_TIMEOUT_MS,
  waitForRetries,
  withOwnedInvocation,
} from "./owned_invocation.js";
import { allAlternativesFailed } from "../src/promise_combinators.js";
import type { PromiseCombinators } from "../src/promise_combinators.js";
import type { SignalTest } from "../src/signals.js";

const PromiseCombinators: PromiseCombinators = {
  name: "PromiseCombinators",
};

const SignalTest: SignalTest = { name: "SignalTest" };

function idempotentSend() {
  return rpc.sendOpts({ idempotencyKey: randomUUID() });
}

// Sends for the #672 tests are bounded too: the invocation id they return is what
// lets the test clean the invocation up.
function boundedIdempotentSend<I = unknown>() {
  return rpc.sendOpts<I>({
    idempotencyKey: randomUUID(),
    timeout: SEND_TIMEOUT_MS,
  });
}

function endpoints() {
  return { adminUrl: getAdminUrl(), ingressUrl: getIngressUrl() };
}

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

  it("any with one fulfilled among rejected returns the fulfilled value", async () => {
    const result = await client.anyWithOneFulfilled({
      messages: ["err1", "err2", "err3"],
      fulfillIndex: 1,
      value: "ok",
    });
    expect(result).toBe("ok");
  });

  // TODO: Skipped - AggregateError from Promise.any is not converted to TerminalError by the SDK.
  // See: https://github.com/restatedev/sdk-typescript/issues/672
  // The default behavior is pinned by the "is retried by default" test below; the documented
  // handling pattern is covered by the "AsTerminal" tests.
  it.skip("any with all rejected throws", async () => {
    await expect(client.anyWithAllRejected(["err1", "err2"])).rejects.toThrow();
  });

  it(
    "any with all rejected is retried by default (AggregateError is not a TerminalError)",
    async () => {
      const send = await ingress
        .serviceSendClient(PromiseCombinators)
        .anyWithAllRejected(
          ["err1", "err2"],
          boundedIdempotentSend<string[]>()
        );
      await withOwnedInvocation(
        getAdminUrl(),
        send.invocationId,
        async () => {
          // A second recorded attempt of the same invocation is what distinguishes
          // "retried" from "terminally failed on the first attempt".
          const attempts = await waitForRetries(
            getAdminUrl(),
            send.invocationId,
            2
          );
          expect(attempts.status).not.toBe("completed");
          expect(attempts.lastFailure).toContain("All promises were rejected");
        },
        // Do not leave the invocation retrying behind the test.
        { endAfterwards: true }
      );
    },
    RETRY_TEST_TIMEOUT_MS
  );

  it(
    "any with all rejected: documented inline conversion fails terminally without retries",
    async () => {
      const send = await ingress
        .serviceSendClient(PromiseCombinators)
        .anyWithAllRejectedAsTerminal(
          ["err1", "err2"],
          boundedIdempotentSend<string[]>()
        );
      await expectTerminalFailure(
        endpoints(),
        send.invocationId,
        "All 2 alternatives failed: err1; err2"
      );
    },
    TERMINAL_TEST_TIMEOUT_MS
  );

  it(
    "any with all rejected: documented asTerminalError option fails terminally without retries",
    async () => {
      const send = await ingress
        .serviceSendClient(PromiseCombinators)
        .anyWithAllRejectedAsTerminalErrorOption(
          ["err1", "err2"],
          boundedIdempotentSend<string[]>()
        );
      await expectTerminalFailure(
        endpoints(),
        send.invocationId,
        "All 2 alternatives failed: err1; err2"
      );
    },
    TERMINAL_TEST_TIMEOUT_MS
  );

  it(
    "any with empty input: documented conversion fails terminally",
    async () => {
      const send = await ingress
        .serviceSendClient(PromiseCombinators)
        .anyEmptyAsTerminal(boundedIdempotentSend());
      await expectTerminalFailure(
        endpoints(),
        send.invocationId,
        "All 0 alternatives failed: "
      );
    },
    TERMINAL_TEST_TIMEOUT_MS
  );

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

  // --- allSettled(race(p1, p2), race(p1, p3)) sharing p1 signal ---

  it("allSettled(race(p1, p2), race(p1, p3)) settles both races with p1 when p1 completes first", async () => {
    const send = await ingress
      .serviceSendClient(PromiseCombinators)
      .allSettledOfRacesSharingSignal(idempotentSend());

    // Resolve p1 first — both races should settle with p1.
    await ingress.serviceClient(SignalTest).resolveSignal({
      invocationId: send.invocationId,
      name: "p1",
      value: "from-p1",
    });

    // Resolve p3 afterwards — must not affect the already-settled races.
    await ingress.serviceClient(SignalTest).resolveSignal({
      invocationId: send.invocationId,
      name: "p3",
      value: "from-p3",
    });

    const result = await ingress.result(send);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ status: "fulfilled", value: "from-p1" });
    expect(result[1]).toEqual({ status: "fulfilled", value: "from-p1" });
  }, 30_000);

  it("all(race(map(p1), p2), race(p1, p3))", async () => {
    const send = await ingress
      .serviceSendClient(PromiseCombinators)
      .allOfRacesSharingSignalWithMapping(idempotentSend());

    // Resolve p1 first — both races should settle with p1.
    await ingress.serviceClient(SignalTest).resolveSignal({
      invocationId: send.invocationId,
      name: "p1",
      value: "from-p1",
    });

    // Resolve p3 afterwards — must not affect the already-settled races.
    await ingress.serviceClient(SignalTest).resolveSignal({
      invocationId: send.invocationId,
      name: "p3",
      value: "from-p3",
    });

    await expect(ingress.result(send)).rejects.toThrow("p1 completed");
  }, 30_000);

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

  it("map with sync ctx side effect and const promise produces expected mapped value deterministically", async () => {
    await client.verifyConstPromiseMapInterleaving();
  });

  it("map with sync ctx side effect and non-const promise produces expected mapped value deterministically", async () => {
    await client.verifyPromiseMapInterleaving();
  });

  it("map gets run once", async () => {
    const result = await client.verifyPromiseMapGetsRunOnce();
    expect(result).toBe(1);
  });
});

describe("allAlternativesFailed (documented RestatePromise.any handling pattern)", () => {
  it("converts an aggregate whose reasons are all TerminalError", () => {
    const converted = allAlternativesFailed(
      new AggregateError([new TerminalError("a"), new TerminalError("b")])
    );
    expect(converted).toBeInstanceOf(TerminalError);
    expect(converted?.message).toBe("All 2 alternatives failed: a; b");
  });

  it("converts the empty aggregate produced by any([])", () => {
    const converted = allAlternativesFailed(new AggregateError([]));
    expect(converted).toBeInstanceOf(TerminalError);
    expect(converted?.message).toBe("All 0 alternatives failed: ");
  });

  it("leaves an aggregate with a non-terminal reason retryable", () => {
    expect(
      allAlternativesFailed(
        new AggregateError([new TerminalError("a"), new Error("transient")])
      )
    ).toBeUndefined();
  });

  it("leaves non-aggregate errors untouched", () => {
    expect(allAlternativesFailed(new Error("transient"))).toBeUndefined();
    expect(
      allAlternativesFailed(new TerminalError("already terminal"))
    ).toBeUndefined();
    expect(allAlternativesFailed("not an error")).toBeUndefined();
  });
});
