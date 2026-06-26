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

import type { RetryFailure, RetryPolicy } from "./api.js";

/** Fully resolved retry policy, with all defaults applied. */
export interface ResolvedRetryPolicy {
  maxRetries: number;
  initialInterval: number;
  maxInterval: number;
  multiplier: number;
  shouldRetry?: (failure: RetryFailure, attempt: number) => boolean;
}

const DEFAULT_RETRY_POLICY: ResolvedRetryPolicy = {
  maxRetries: 5,
  initialInterval: 100,
  maxInterval: 2000,
  multiplier: 2,
};

/**
 * Resolve a user supplied retry policy into a fully populated one.
 *
 * Retries are opt-in: returns `undefined` (disabled) when `retry` is omitted or
 * `false`. `true` enables the built-in policy; an object enables it with the
 * provided overrides.
 */
export function resolveRetryPolicy(
  retry: RetryPolicy | boolean | undefined
): ResolvedRetryPolicy | undefined {
  if (retry === undefined || retry === false) {
    return undefined;
  }
  if (retry === true) {
    return DEFAULT_RETRY_POLICY;
  }
  return {
    maxRetries: retry.maxRetries ?? DEFAULT_RETRY_POLICY.maxRetries,
    initialInterval:
      retry.initialInterval ?? DEFAULT_RETRY_POLICY.initialInterval,
    maxInterval: retry.maxInterval ?? DEFAULT_RETRY_POLICY.maxInterval,
    multiplier: retry.multiplier ?? DEFAULT_RETRY_POLICY.multiplier,
    shouldRetry: retry.shouldRetry,
  };
}

/** Whether an HTTP response status warrants a retry. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/**
 * The built-in retry decision: retry network errors, HTTP `429`, and HTTP
 * `5xx`. Exported so a custom {@link RetryPolicy.shouldRetry} can compose with
 * it rather than reimplement it.
 */
export function defaultShouldRetry(failure: RetryFailure): boolean {
  return failure.kind === "network" || isRetryableStatus(failure.status);
}

/**
 * Compute the backoff for the given (zero based) attempt index using
 * exponential backoff with full jitter, capped at `maxInterval`.
 *
 * When the server provided an explicit `Retry-After` we honor it instead,
 * capped at `maxInterval` to avoid pathologically long waits.
 */
export function backoffDelay(
  policy: ResolvedRetryPolicy,
  attempt: number,
  retryAfterMs?: number
): number {
  if (retryAfterMs !== undefined) {
    return Math.min(retryAfterMs, policy.maxInterval);
  }
  const exp = policy.initialInterval * Math.pow(policy.multiplier, attempt);
  const ceiling = Math.min(exp, policy.maxInterval);
  // full jitter: random in [0, ceiling]
  return Math.random() * ceiling;
}

/**
 * Parse a `Retry-After` header value into milliseconds.
 *
 * Supports both the delay-seconds form (`"120"`) and the HTTP-date form
 * (`"Wed, 21 Oct 2015 07:28:00 GMT"`). Returns `undefined` when absent or
 * unparseable.
 */
export function parseRetryAfter(
  headers: Headers,
  now: number = Date.now()
): number | undefined {
  const value = headers.get("retry-after");
  if (!value) {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const dateMs = Date.parse(value);
  if (Number.isNaN(dateMs)) {
    return undefined;
  }
  return Math.max(0, dateMs - now);
}

/**
 * Sleep for `ms`, rejecting early if `signal` aborts in the meantime.
 */
export function abortableSleep(
  ms: number,
  signal?: AbortSignal
): Promise<void> {
  const abortError = (): Error => {
    const reason: unknown = signal?.reason;
    return reason instanceof Error
      ? reason
      : new Error("The operation was aborted");
  };
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
