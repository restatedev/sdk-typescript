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
      initialInterval: 100,
      maxInterval: 2000,
      exponentiationFactor: 2,
    });
  });

  it("fills in missing fields with defaults", () => {
    expect(resolveRetryPolicy({ maxAttempts: 3 })).toEqual({
      maxAttempts: 3,
      initialInterval: 100,
      maxInterval: 2000,
      exponentiationFactor: 2,
      shouldRetry: undefined,
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

  it("rejects a maxAttempts that is not a positive integer", () => {
    expect(() => resolveRetryPolicy({ maxAttempts: Infinity })).toThrow(
      TypeError
    );
    expect(() => resolveRetryPolicy({ maxAttempts: 0 })).toThrow(TypeError);
    expect(() => resolveRetryPolicy({ maxAttempts: -1 })).toThrow(TypeError);
    expect(() => resolveRetryPolicy({ maxAttempts: 2.5 })).toThrow(TypeError);
    expect(() => resolveRetryPolicy({ maxAttempts: NaN })).toThrow(TypeError);
  });

  it("accepts maxAttempts of 1, which simply makes no retry", () => {
    expect(resolveRetryPolicy({ maxAttempts: 1 })).toMatchObject({
      maxAttempts: 1,
    });
  });

  it("rejects intervals that are negative or not finite", () => {
    expect(() => resolveRetryPolicy({ initialInterval: -1 })).toThrow(
      TypeError
    );
    expect(() => resolveRetryPolicy({ initialInterval: Infinity })).toThrow(
      TypeError
    );
    expect(() => resolveRetryPolicy({ maxInterval: -1 })).toThrow(TypeError);
    expect(() => resolveRetryPolicy({ maxInterval: NaN })).toThrow(TypeError);
  });

  it("rejects an exponentiation factor below 1 or not finite", () => {
    expect(() => resolveRetryPolicy({ exponentiationFactor: 0 })).toThrow(
      TypeError
    );
    expect(() => resolveRetryPolicy({ exponentiationFactor: 0.5 })).toThrow(
      TypeError
    );
    expect(() =>
      resolveRetryPolicy({ exponentiationFactor: Infinity })
    ).toThrow(TypeError);
  });

  it("names the offending field in the error", () => {
    expect(() => resolveRetryPolicy({ maxInterval: -1 })).toThrow(
      /retry\.maxInterval/
    );
  });
});

describe("defaultShouldRetry", () => {
  it("retries network errors and 429/5xx responses", () => {
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

  it("does not retry a 5xx that reports an invocation's own outcome", () => {
    // A handler's TerminalError surfaces with the failure's own status; the
    // ingress marks such responses with the invocation id.
    expect(
      defaultShouldRetry({
        kind: "response",
        status: 500,
        headers: new Headers({ "x-restate-id": "inv_1abc" }),
      })
    ).toBe(false);
  });
});

describe("isRetryableStatus", () => {
  it("retries on 429 and 5xx", () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(599)).toBe(true);
  });

  it("does not retry on 4xx (except 429) or 2xx/3xx", () => {
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
  };

  it("never exceeds the per-attempt ceiling (full jitter)", () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const ceiling = Math.min(100 * 2 ** attempt, 2000);
      for (let i = 0; i < 50; i++) {
        const d = backoffDelay(policy, attempt);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(ceiling);
      }
    }
  });

  it("honors Retry-After, capped at maxInterval", () => {
    expect(backoffDelay(policy, 0, 500)).toBe(500);
    expect(backoffDelay(policy, 0, 10_000)).toBe(2000);
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
// Integration: retry behavior through connect()
// ---------------------------------------------------------------------------

const URL = "http://localhost:8080";

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
// Headers arrived, then the connection died part-way through the body.
const streamerr =
  (msg: string, status = 200, headers?: Record<string, string>): Attempt =>
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
    return Promise.resolve(new Response(body, { status, headers }));
  };

const fastRetry = {
  initialInterval: 1,
  maxInterval: 2,
  exponentiationFactor: 2,
};

/**
 * Stub out global fetch for the enclosing describe, returning a `queue` that
 * plays back a sequence of attempts, repeating the last one.
 */
const stubFetch = () => {
  let fetchMock!: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  return {
    calls: () => fetchMock.mock.calls,
    attempts: () => fetchMock.mock.calls.length,
    queue: (...attempts: Attempt[]) => {
      let i = 0;
      fetchMock.mockImplementation(() =>
        attempts[Math.min(i++, attempts.length - 1)]!()
      );
    },
  };
};

describe("ingress auto-retry", () => {
  const { queue, calls, attempts } = stubFetch();

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

  it("does NOT retry without an idempotency key", async () => {
    queue(fail(503), ok());
    await expect(call(undefined, fastRetry)).rejects.toBeInstanceOf(
      HttpCallError
    );
    expect(attempts()).toBe(1);
  });

  it("does NOT retry by default — retries are opt-in", async () => {
    queue(fail(503), ok());
    await expect(call("k1", undefined)).rejects.toBeInstanceOf(HttpCallError);
    expect(attempts()).toBe(1);
  });

  it("retry:true enables the built-in policy", async () => {
    queue(fail(503), ok());
    await expect(call("k1", true)).resolves.toEqual({ ok: true });
    expect(attempts()).toBeGreaterThanOrEqual(2);
  });

  it("retries 5xx then succeeds when an idempotency key is set", async () => {
    queue(fail(500), fail(503), ok({ greeting: "hi" }));
    await expect(call("k1", fastRetry)).resolves.toEqual({ greeting: "hi" });
    expect(attempts()).toBe(3);
  });

  it("retries on 429", async () => {
    queue(fail(429), ok());
    await expect(call("k1", fastRetry)).resolves.toEqual({ ok: true });
    expect(attempts()).toBe(2);
  });

  it("retries on a network error", async () => {
    queue(neterr("connection refused"), ok());
    await expect(call("k1", fastRetry)).resolves.toEqual({ ok: true });
    expect(attempts()).toBe(2);
  });

  it("retries when a successful response body stream fails", async () => {
    queue(streamerr("stream interrupted"), ok({ greeting: "hi" }));
    await expect(call("k1", fastRetry)).resolves.toEqual({ greeting: "hi" });
    expect(attempts()).toBe(2);
  });

  it("does NOT retry workflow submission without a retry policy", async () => {
    queue(fail(503), ok());
    await expect(workflow().workflowSubmit({})).rejects.toBeInstanceOf(
      HttpCallError
    );
    expect(attempts()).toBe(1);
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
    expect(attempts()).toBe(2);
  });

  it("retries scoped workflow submission without an idempotency key", async () => {
    queue(fail(503), ok({ invocationId: "invocation-id", status: "Accepted" }));
    await expect(
      scopedWorkflow(fastRetry).workflowSubmit({})
    ).resolves.toMatchObject({
      invocationId: "invocation-id",
      status: "Accepted",
    });
    expect(attempts()).toBe(2);
  });

  it("does NOT retry workflow attach without a retry policy", async () => {
    queue(fail(503), ok());
    await expect(workflow().workflowAttach()).rejects.toBeInstanceOf(
      HttpCallError
    );
    expect(attempts()).toBe(1);
  });

  it("retries workflow attach without an idempotency key", async () => {
    queue(fail(503), ok({ result: "done" }));
    await expect(workflow(fastRetry).workflowAttach()).resolves.toEqual({
      result: "done",
    });
    expect(attempts()).toBe(2);
  });

  it("does NOT retry workflow output without a retry policy", async () => {
    queue(fail(503), ok({ result: "done" }));
    await expect(workflow().workflowOutput()).rejects.toBeInstanceOf(
      HttpCallError
    );
    expect(attempts()).toBe(1);
  });

  it("retries workflow output without an idempotency key", async () => {
    queue(fail(503), ok({ result: "done" }));
    await expect(workflow(fastRetry).workflowOutput()).resolves.toEqual({
      ready: true,
      result: { result: "done" },
    });
    expect(attempts()).toBe(2);
  });

  it("does NOT retry workflow output when it is not ready by default", async () => {
    queue(fail(470), ok({ result: "done" }));
    const output = await workflow(fastRetry).workflowOutput();
    expect(output.ready).toBe(false);
    expect(attempts()).toBe(1);
  });

  it("does NOT retry on a non-retryable 4xx", async () => {
    queue(fail(409), ok());
    await expect(call("k1", fastRetry)).rejects.toBeInstanceOf(HttpCallError);
    expect(attempts()).toBe(1);
  });

  it("retry:false disables retries even with an idempotency key", async () => {
    queue(fail(503), ok());
    await expect(call("k1", false)).rejects.toBeInstanceOf(HttpCallError);
    expect(attempts()).toBe(1);
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
    expect(attempts()).toBe(1);
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
    expect(attempts()).toBe(3); // initial + 2 retries
  });

  it("mints a fresh timeout signal per attempt", async () => {
    queue(fail(500), ok());
    await connect({ url: URL, retry: fastRetry }).call({
      service: "svc",
      handler: "greet",
      parameter: {},
      opts: Opts.from({ idempotencyKey: "k1", timeout: 10_000 }),
    });
    const signals = calls().map((c) => (c[1] as RequestInit).signal);
    expect(signals[0]).not.toBe(signals[1]);
    expect(signals[0]?.aborted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Integration: reading the outcome of an existing invocation — result(),
// workflowOutput, and workflowAttach beyond the cases above. These GETs must
// survive an ingress draining mid-read during a rolling deploy, which is what
// the drain 503, the reset connection and the truncated body stand in for.
// ---------------------------------------------------------------------------

describe("ingress read auto-retry", () => {
  const { queue, calls, attempts } = stubFetch();

  // What a draining ingress sends: 503 plus, on HTTP/1.1, a connection close.
  const drain = fail(503, { "retry-after": "0", connection: "close" });
  // A handler's TerminalError, which the ingress reports with the failure's own
  // status and marks with the invocation id.
  const terminalFailure = fail(500, { "x-restate-id": "inv_1abc" });

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

  const result = (retry?: RetryPolicy | boolean) =>
    connect({ url: URL, retry }).result({
      invocationId: "inv_1abc",
      status: "Accepted",
      attachable: true,
    });

  describe("result()", () => {
    it("retries a drain 503, then succeeds", async () => {
      queue(drain, ok({ greeting: "hi" }));
      await expect(result(fastRetry)).resolves.toEqual({ greeting: "hi" });
      expect(attempts()).toBe(2);
    });

    it("retries a transport failure, then succeeds", async () => {
      queue(neterr("socket hang up"), ok({ greeting: "hi" }));
      await expect(result(fastRetry)).resolves.toEqual({ greeting: "hi" });
      expect(attempts()).toBe(2);
    });

    it("retries a body cut short after a 200, then succeeds", async () => {
      queue(streamerr("stream interrupted"), ok({ greeting: "hi" }));
      await expect(result(fastRetry)).resolves.toEqual({ greeting: "hi" });
      expect(attempts()).toBe(2);
    });

    it("retries a body cut short after a drain 503, then succeeds", async () => {
      queue(streamerr("stream interrupted", 503), ok({ greeting: "hi" }));
      await expect(result(fastRetry)).resolves.toEqual({ greeting: "hi" });
      expect(attempts()).toBe(2);
    });

    it("needs no idempotency key — the read itself is safe", async () => {
      queue(drain, ok());
      await expect(result(true)).resolves.toEqual({ ok: true });
      expect(attempts()).toBeGreaterThanOrEqual(2);
    });

    it("does NOT retry by default — retries are opt-in", async () => {
      queue(drain, ok());
      await expect(result()).rejects.toBeInstanceOf(HttpCallError);
      expect(attempts()).toBe(1);
    });

    it("does NOT retry an invocation's own terminal failure", async () => {
      queue(terminalFailure, ok());
      await expect(result(fastRetry)).rejects.toMatchObject({ status: 500 });
      expect(attempts()).toBe(1);
    });

    it("gives up after maxAttempts and throws the last error", async () => {
      queue(drain);
      await expect(
        result({ ...fastRetry, maxAttempts: 3 })
      ).rejects.toMatchObject({ status: 503, responseText: "nope" });
      expect(attempts()).toBe(3);
    });

    it("does not fetch at all when the send is not attachable", async () => {
      queue(ok());
      await expect(
        connect({ url: URL, retry: fastRetry }).result({
          invocationId: "inv_1abc",
          status: "Accepted",
          attachable: false,
        })
      ).rejects.toThrow(/Unable to fetch the result/);
      expect(attempts()).toBe(0);
    });
  });

  describe("workflowAttach", () => {
    it("retries a body cut short, then succeeds", async () => {
      queue(streamerr("stream interrupted"), ok({ done: true }));
      await expect(workflow(fastRetry).workflowAttach()).resolves.toEqual({
        done: true,
      });
      expect(attempts()).toBe(2);
    });

    it("does NOT retry once the caller has aborted", async () => {
      queue(drain, ok());
      const ac = new AbortController();
      ac.abort(new Error("caller gave up"));
      await expect(
        workflow(fastRetry).workflowAttach(Opts.from({ signal: ac.signal }))
      ).rejects.toThrow();
      expect(attempts()).toBe(1);
    });

    it("stops retrying when the caller aborts between attempts", async () => {
      const ac = new AbortController();
      queue(() => {
        ac.abort(new Error("caller gave up"));
        return Promise.resolve(new Response("nope", { status: 503 }));
      }, ok());
      await expect(
        workflow({ ...fastRetry, initialInterval: 10_000 }).workflowAttach(
          Opts.from({ signal: ac.signal })
        )
      ).rejects.toBeInstanceOf(HttpCallError);
      expect(attempts()).toBe(1);
    });

    it("bounds the whole read, retries included, with one timeout signal", async () => {
      queue(drain, ok());
      await workflow(fastRetry).workflowAttach(Opts.from({ timeout: 10_000 }));
      const signals = calls().map((c) => (c[1] as RequestInit).signal);
      expect(attempts()).toBe(2);
      expect(signals[0]).toBe(signals[1]);
    });

    it("does NOT retry an invocation's own terminal failure", async () => {
      queue(terminalFailure, ok());
      await expect(workflow(fastRetry).workflowAttach()).rejects.toMatchObject({
        status: 500,
      });
      expect(attempts()).toBe(1);
    });
  });

  describe("workflowOutput", () => {
    it("retries a drain 503, then reports the output as not ready", async () => {
      queue(drain, fail(470));
      await expect(workflow(fastRetry).workflowOutput()).resolves.toMatchObject(
        { ready: false }
      );
      expect(attempts()).toBe(2);
    });

    it("does NOT retry the 470 that means 'not ready yet'", async () => {
      queue(fail(470), ok());
      await expect(workflow(fastRetry).workflowOutput()).resolves.toMatchObject(
        { ready: false }
      );
      expect(attempts()).toBe(1);
    });

    it("retries a transport failure, then returns the output", async () => {
      queue(neterr("ECONNRESET"), ok({ done: true }));
      await expect(workflow(fastRetry).workflowOutput()).resolves.toEqual({
        ready: true,
        result: { done: true },
      });
      expect(attempts()).toBe(2);
    });
  });

  describe("scoped workflow reads", () => {
    it("retries a drain 503 on attach, then succeeds", async () => {
      queue(drain, ok({ done: true }));
      await expect(scopedWorkflow(fastRetry).workflowAttach()).resolves.toEqual(
        { done: true }
      );
      expect(attempts()).toBe(2);
    });

    it("retries a drain 503 on output, then succeeds", async () => {
      queue(drain, ok({ done: true }));
      await expect(scopedWorkflow(fastRetry).workflowOutput()).resolves.toEqual(
        { ready: true, result: { done: true } }
      );
      expect(attempts()).toBe(2);
    });
  });
});
