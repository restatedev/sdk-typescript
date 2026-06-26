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

describe("resolveRetryPolicy", () => {
  it("is disabled (undefined) when unset — retries are opt-in", () => {
    expect(resolveRetryPolicy(undefined)).toBeUndefined();
  });

  it("returns undefined when disabled with false", () => {
    expect(resolveRetryPolicy(false)).toBeUndefined();
  });

  it("returns the default policy when enabled with true", () => {
    expect(resolveRetryPolicy(true)).toEqual({
      maxRetries: 5,
      initialInterval: 100,
      maxInterval: 2000,
      multiplier: 2,
    });
  });

  it("fills in missing fields with defaults", () => {
    expect(resolveRetryPolicy({ maxRetries: 1 })).toEqual({
      maxRetries: 1,
      initialInterval: 100,
      maxInterval: 2000,
      multiplier: 2,
      shouldRetry: undefined,
    });
  });

  it("carries a custom shouldRetry through", () => {
    const shouldRetry = () => false;
    expect(resolveRetryPolicy({ shouldRetry })).toMatchObject({ shouldRetry });
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
    maxRetries: 5,
    initialInterval: 100,
    maxInterval: 2000,
    multiplier: 2,
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

  // A fetch mock that plays back a queued sequence, repeating the last item.
  const queue = (...attempts: Attempt[]) => {
    let i = 0;
    fetchMock.mockImplementation(() =>
      attempts[Math.min(i++, attempts.length - 1)]!()
    );
  };

  const fastRetry = { initialInterval: 1, maxInterval: 2, multiplier: 2 };

  const call = (idempotencyKey?: string, retry?: RetryPolicy | boolean) =>
    connect({ url: URL, retry }).call({
      service: "svc",
      handler: "greet",
      parameter: {},
      opts: idempotencyKey ? Opts.from({ idempotencyKey }) : undefined,
    });

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

  it("does NOT retry on a non-retryable 4xx", async () => {
    queue(fail(409), ok());
    await expect(call("k1", fastRetry)).rejects.toBeInstanceOf(HttpCallError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

  it("gives up after maxRetries and throws the last error", async () => {
    queue(fail(500));
    await expect(
      call("k1", { ...fastRetry, maxRetries: 2 })
    ).rejects.toMatchObject({ status: 500 });
    expect(fetchMock).toHaveBeenCalledTimes(3); // initial + 2 retries
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
