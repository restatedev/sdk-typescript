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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  abortableSleep,
  backoffDelay,
  defaultShouldRetry,
  isRetryableStatus,
  parseRetryAfter,
  resolveRetryPolicy,
} from "./retry.js";
import { connect, HttpCallError } from "./ingress.js";
import { Opts, type RetryPolicy } from "./api.js";
import type { WorkflowDefinition } from "@restatedev/restate-sdk-core";

describe("resolveRetryPolicy", () => {
  it("is disabled (undefined) when unset — retries are opt-in", () => {
    expect(resolveRetryPolicy(undefined)).toBeUndefined();
  });

  it("returns undefined when disabled with false", () => {
    expect(resolveRetryPolicy(false)).toBeUndefined();
  });

  it("returns the default policy when enabled with true", () => {
    expect(resolveRetryPolicy(true)).toEqual({
      maxAttempts: 6,
      initialInterval: 250,
      maxInterval: 3000,
      exponentiationFactor: 2,
      respectRetryAfter: true,
    });
  });

  it("fills in missing fields with defaults", () => {
    expect(resolveRetryPolicy({ maxAttempts: 3 })).toEqual({
      maxAttempts: 3,
      initialInterval: 250,
      maxInterval: 3000,
      exponentiationFactor: 2,
      respectRetryAfter: true,
      shouldRetry: undefined,
    });
  });

  it("carries respectRetryAfter: false through", () => {
    expect(resolveRetryPolicy({ respectRetryAfter: false })).toMatchObject({
      respectRetryAfter: false,
    });
  });

  it("carries a custom shouldRetry through", () => {
    const shouldRetry = () => false;
    expect(resolveRetryPolicy({ shouldRetry })).toMatchObject({ shouldRetry });
  });

  it("accepts Duration intervals, resolving them to milliseconds", () => {
    expect(
      resolveRetryPolicy({
        initialInterval: { seconds: 1 },
        maxInterval: { seconds: 30 },
      })
    ).toMatchObject({
      initialInterval: 1000,
      maxInterval: 30_000,
    });
  });
});

describe("defaultShouldRetry", () => {
  it("retries network errors and transient responses", () => {
    expect(defaultShouldRetry({ kind: "network", error: new Error("x") })).toBe(
      true
    );
    expect(
      defaultShouldRetry({
        kind: "response",
        status: 503,
        headers: new Headers(),
      })
    ).toBe(true);
  });

  it("does not retry non-retryable responses", () => {
    expect(
      defaultShouldRetry({
        kind: "response",
        status: 409,
        headers: new Headers(),
      })
    ).toBe(false);
  });

  it("retries a transient status flagged as an ingress error", () => {
    expect(
      defaultShouldRetry({
        kind: "response",
        status: 503,
        headers: new Headers({ "x-restate-error-source": "ingress" }),
      })
    ).toBe(true);
  });

  it("does NOT retry an invocation-sourced error even on a 5xx", () => {
    expect(
      defaultShouldRetry({
        kind: "response",
        status: 500,
        headers: new Headers({ "x-restate-error-source": "invocation" }),
      })
    ).toBe(false);
  });
});

describe("isRetryableStatus", () => {
  it("retries on 408, 425, 429 and 5xx", () => {
    expect(isRetryableStatus(408)).toBe(true);
    expect(isRetryableStatus(425)).toBe(true);
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(599)).toBe(true);
  });

  it("does not retry on non-transient 4xx or 2xx/3xx", () => {
    expect(isRetryableStatus(200)).toBe(false);
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
    expect(isRetryableStatus(409)).toBe(false);
    expect(isRetryableStatus(470)).toBe(false);
  });
});

describe("backoffDelay", () => {
  const policy = {
    maxAttempts: 6,
    initialInterval: 100,
    maxInterval: 2000,
    exponentiationFactor: 2,
    respectRetryAfter: true,
  };

  it("stays within ±20% of the (capped) exponential base", () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const base = Math.min(100 * 2 ** attempt, 2000);
      for (let i = 0; i < 50; i++) {
        const d = backoffDelay(policy, attempt);
        expect(d).toBeGreaterThanOrEqual(base * 0.8);
        expect(d).toBeLessThanOrEqual(base * 1.2);
      }
    }
  });
});

describe("parseRetryAfter", () => {
  const h = (v?: string) => new Headers(v ? { "retry-after": v } : {});

  it("returns undefined when absent", () => {
    expect(parseRetryAfter(h())).toBeUndefined();
  });

  it("parses delay-seconds", () => {
    expect(parseRetryAfter(h("2"))).toBe(2000);
  });

  it("parses an HTTP-date relative to now", () => {
    const now = 1_000_000;
    const date = new Date(now + 3000).toUTCString();
    expect(parseRetryAfter(h(date), now)).toBe(3000);
  });

  it("returns undefined for garbage", () => {
    expect(parseRetryAfter(h("not-a-date"))).toBeUndefined();
  });
});

describe("abortableSleep", () => {
  it("resolves after the delay", async () => {
    await expect(abortableSleep(1)).resolves.toBeUndefined();
  });

  it("rejects immediately when the signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort(new Error("boom"));
    await expect(abortableSleep(1000, ac.signal)).rejects.toThrow("boom");
  });

  it("rejects when aborted mid-sleep", async () => {
    const ac = new AbortController();
    const p = abortableSleep(1000, ac.signal);
    ac.abort(new Error("late"));
    await expect(p).rejects.toThrow("late");
  });
});

// ---------------------------------------------------------------------------
// Integration: retry behavior through connect()/call()
// ---------------------------------------------------------------------------

describe("ingress auto-retry", () => {
  const URL = "http://localhost:8080";
  let fetchMock: ReturnType<typeof vi.fn>;

  // Response/error factories — a fresh, unread Response per attempt (real
  // fetch hands back a new Response per call).
  type Attempt = () => Promise<Response>;
  const ok =
    (body: unknown = { ok: true }): Attempt =>
    () =>
      Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  const fail =
    (status: number, headers?: Record<string, string>): Attempt =>
    () =>
      Promise.resolve(new Response("nope", { status, headers }));
  const neterr =
    (msg: string): Attempt =>
    () =>
      Promise.reject(new TypeError(msg));
  const streamerr =
    (msg: string): Attempt =>
    () => {
      let sentChunk = false;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (!sentChunk) {
            controller.enqueue(new TextEncoder().encode('{"partial":'));
            sentChunk = true;
            return;
          }
          controller.error(new TypeError(msg));
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    };

  // A fetch mock that plays back a queued sequence, repeating the last item.
  const queue = (...attempts: Attempt[]) => {
    let i = 0;
    fetchMock.mockImplementation(() =>
      attempts[Math.min(i++, attempts.length - 1)]!()
    );
  };

  const fastRetry = {
    initialInterval: 1,
    maxInterval: 2,
    exponentiationFactor: 2,
  };

  const call = (idempotencyKey?: string, retry?: RetryPolicy | boolean) =>
    connect({ url: URL, retry }).call({
      service: "svc",
      handler: "greet",
      parameter: {},
      opts: idempotencyKey ? Opts.from({ idempotencyKey }) : undefined,
    });

  type TestWorkflow = WorkflowDefinition<
    "workflow",
    {
      run: (
        context: unknown,
        input: Record<string, unknown>
      ) => Promise<Record<string, unknown>>;
    }
  >;
  const testWorkflow: TestWorkflow = { name: "workflow" };
  const workflow = (retry?: RetryPolicy | boolean) =>
    connect({ url: URL, retry }).workflowClient(testWorkflow, "workflow-id");
  const scopedWorkflow = (retry?: RetryPolicy | boolean) =>
    connect({ url: URL, retry })
      .scope("scope")
      .workflowClient(testWorkflow, "workflow-id");

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does NOT retry without an idempotency key", async () => {
    queue(fail(503), ok());
    await expect(call(undefined, fastRetry)).rejects.toBeInstanceOf(
      HttpCallError
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry by default — retries are opt-in", async () => {
    queue(fail(503), ok());
    await expect(call("k1", undefined)).rejects.toBeInstanceOf(HttpCallError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retry:true enables the built-in policy", async () => {
    queue(fail(503), ok());
    await expect(call("k1", true)).resolves.toEqual({ ok: true });
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("retries 5xx then succeeds when an idempotency key is set", async () => {
    queue(fail(500), fail(503), ok({ greeting: "hi" }));
    await expect(call("k1", fastRetry)).resolves.toEqual({ greeting: "hi" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries on 429", async () => {
    queue(fail(429), ok());
    await expect(call("k1", fastRetry)).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries on a network error", async () => {
    queue(neterr("connection refused"), ok());
    await expect(call("k1", fastRetry)).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries when a successful response body stream fails", async () => {
    queue(streamerr("stream interrupted"), ok({ greeting: "hi" }));
    await expect(call("k1", fastRetry)).resolves.toEqual({ greeting: "hi" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry workflow submission without a retry policy", async () => {
    queue(fail(503), ok());
    await expect(workflow().workflowSubmit({})).rejects.toBeInstanceOf(
      HttpCallError
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries workflow submission without an idempotency key", async () => {
    queue(
      neterr("response lost"),
      ok({ invocationId: "invocation-id", status: "PreviouslyAccepted" })
    );
    await expect(workflow(fastRetry).workflowSubmit({})).resolves.toMatchObject(
      {
        invocationId: "invocation-id",
        status: "PreviouslyAccepted",
      }
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries scoped workflow submission without an idempotency key", async () => {
    queue(fail(503), ok({ invocationId: "invocation-id", status: "Accepted" }));
    await expect(
      scopedWorkflow(fastRetry).workflowSubmit({})
    ).resolves.toMatchObject({
      invocationId: "invocation-id",
      status: "Accepted",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry workflow attach without a retry policy", async () => {
    queue(fail(503), ok());
    await expect(workflow().workflowAttach()).rejects.toBeInstanceOf(
      HttpCallError
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries workflow attach without an idempotency key", async () => {
    queue(fail(503), ok({ result: "done" }));
    await expect(workflow(fastRetry).workflowAttach()).resolves.toEqual({
      result: "done",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry workflow output without a retry policy", async () => {
    queue(fail(503), ok({ result: "done" }));
    await expect(workflow().workflowOutput()).rejects.toBeInstanceOf(
      HttpCallError
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries workflow output without an idempotency key", async () => {
    queue(fail(503), ok({ result: "done" }));
    await expect(workflow(fastRetry).workflowOutput()).resolves.toEqual({
      ready: true,
      result: { result: "done" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry result() without a retry policy", async () => {
    queue(fail(503), ok({ greeting: "hi" }));
    await expect(
      connect({ url: URL }).result({
        invocationId: "inv-1",
        status: "Accepted",
        attachable: true,
      })
    ).rejects.toBeInstanceOf(HttpCallError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries result() attach when a retry policy is set", async () => {
    queue(fail(503), ok({ greeting: "hi" }));
    await expect(
      connect({ url: URL, retry: fastRetry }).result({
        invocationId: "inv-1",
        status: "Accepted",
        attachable: true,
      })
    ).resolves.toEqual({ greeting: "hi" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry workflow output when it is not ready by default", async () => {
    queue(fail(470), ok({ result: "done" }));
    const output = await workflow(fastRetry).workflowOutput();
    expect(output.ready).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry on a non-retryable 4xx", async () => {
    queue(fail(409), ok());
    await expect(call("k1", fastRetry)).rejects.toBeInstanceOf(HttpCallError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries the new transient statuses 408 and 425", async () => {
    queue(fail(408), fail(425), ok({ greeting: "hi" }));
    await expect(call("k1", fastRetry)).resolves.toEqual({ greeting: "hi" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry an invocation-sourced 5xx", async () => {
    queue(fail(500, { "x-restate-error-source": "invocation" }), ok());
    await expect(call("k1", fastRetry)).rejects.toBeInstanceOf(HttpCallError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries an ingress-sourced 5xx", async () => {
    queue(fail(503, { "x-restate-error-source": "ingress" }), ok());
    await expect(call("k1", fastRetry)).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retry:false disables retries even with an idempotency key", async () => {
    queue(fail(503), ok());
    await expect(call("k1", false)).rejects.toBeInstanceOf(HttpCallError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a custom shouldRetry can narrow the decision (no retry on 500)", async () => {
    queue(fail(500), ok());
    await expect(
      call("k1", {
        ...fastRetry,
        shouldRetry: (f) =>
          defaultShouldRetry(f) && !(f.kind === "response" && f.status === 500),
      })
    ).rejects.toMatchObject({ status: 500 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a custom shouldRetry can inspect the response body", async () => {
    queue(fail(503, undefined), ok());
    const seen: Array<string | undefined> = [];
    await call("k1", {
      ...fastRetry,
      shouldRetry: (f) => {
        if (f.kind === "response") seen.push(f.body);
        return defaultShouldRetry(f);
      },
    });
    expect(seen).toEqual(["nope"]); // body text was available to the predicate
  });

  it("gives up after maxAttempts and throws the last error", async () => {
    queue(fail(500));
    await expect(
      call("k1", { ...fastRetry, maxAttempts: 3 })
    ).rejects.toMatchObject({ status: 500 });
    expect(fetchMock).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  const attemptHeaders = () =>
    fetchMock.mock.calls.map(
      (c) => (c[1] as RequestInit).headers as Record<string, string>
    );

  it("stamps x-restateclient-attempt: 1 on a non-retried request", async () => {
    queue(ok({ greeting: "hi" }));
    await call("k1");
    expect(attemptHeaders()[0]?.["x-restateclient-attempt"]).toBe("1");
  });

  it("stamps an incrementing x-restateclient-attempt header on each attempt", async () => {
    queue(fail(503), fail(503), ok({ greeting: "hi" }));
    await expect(call("k1", fastRetry)).resolves.toEqual({ greeting: "hi" });
    expect(attemptHeaders().map((h) => h["x-restateclient-attempt"])).toEqual([
      "1",
      "2",
      "3",
    ]);
  });

  it("stops at maxAttempts even when the server keeps sending Retry-After", async () => {
    // Retry-After: 0 keeps the delays instantaneous; the cap must still hold.
    queue(fail(503, { "retry-after": "0" }));
    await expect(
      call("k1", { ...fastRetry, maxAttempts: 3 })
    ).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("honors Retry-After verbatim by default, beyond maxInterval", async () => {
    vi.useFakeTimers();
    try {
      queue(fail(503, { "retry-after": "5" }), ok({ greeting: "hi" }));
      // maxInterval is a mere 2ms, far below the 5s Retry-After: if it were
      // capped, the retry would fire almost immediately.
      const p = call("k1", {
        initialInterval: 1,
        maxInterval: 2,
        exponentiationFactor: 2,
        maxAttempts: 2,
      });
      await vi.advanceTimersByTimeAsync(0); // let the first attempt fail
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(3); // past maxInterval, but not the 5s wait
      expect(fetchMock).toHaveBeenCalledTimes(1); // still waiting out the Retry-After
      await vi.advanceTimersByTimeAsync(5000);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await expect(p).resolves.toEqual({ greeting: "hi" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores Retry-After when respectRetryAfter is false", async () => {
    vi.useFakeTimers();
    try {
      queue(fail(503, { "retry-after": "5" }), ok({ greeting: "hi" }));
      const p = call("k1", {
        initialInterval: 100,
        maxInterval: 100,
        exponentiationFactor: 2,
        maxAttempts: 2,
        respectRetryAfter: false,
      });
      await vi.advanceTimersByTimeAsync(0); // let the first attempt fail
      // The exponential backoff base is 100ms — far below the 5s Retry-After
      // the server asked for. Advancing 200ms (past the jittered base) retries,
      // proving the header was ignored.
      await vi.advanceTimersByTimeAsync(200);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await expect(p).resolves.toEqual({ greeting: "hi" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("mints a fresh timeout signal per attempt", async () => {
    queue(fail(500), ok());
    await connect({ url: URL, retry: fastRetry }).call({
      service: "svc",
      handler: "greet",
      parameter: {},
      opts: Opts.from({ idempotencyKey: "k1", timeout: 10_000 }),
    });
    const signals = fetchMock.mock.calls.map(
      (c) => (c[1] as RequestInit).signal
    );
    expect(signals[0]).not.toBe(signals[1]);
    expect(signals[0]?.aborted).toBe(false);
  });
});
