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

import { millisOrDurationToMillis } from "@restatedev/restate-sdk-core";
import type { RetryFailure, RetryPolicy } from "./api.js";

/** Fully resolved retry policy, with all defaults applied. */
export interface ResolvedRetryPolicy {
  maxAttempts: number;
  initialInterval: number;
  maxInterval: number;
  exponentiationFactor: number;
  shouldRetry?: (failure: RetryFailure, attempt: number) => boolean;
}

const DEFAULT_RETRY_POLICY: ResolvedRetryPolicy = {
  maxAttempts: 6,
  initialInterval: 100,
  maxInterval: 2000,
  exponentiationFactor: 2,
};

/**
 * Bounds are checked rather than clamped: a policy that cannot be honored as
 * written — an unbounded `maxAttempts`, a backoff that collapses to an immediate
 * retry — is a mistake to surface, not to quietly reinterpret.
 */
const checkedAttempts = (value: number): number => {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(
      `retry.maxAttempts must be an integer of at least 1, got ${value}`
    );
  }
  return value;
};

const checkedInterval = (name: string, value: number): number => {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(
      `retry.${name} must be a finite, non-negative duration, got ${value}`
    );
  }
  return value;
};

const checkedFactor = (value: number): number => {
  if (!Number.isFinite(value) || value < 1) {
    throw new TypeError(
      `retry.exponentiationFactor must be a finite number of at least 1, got ${value}`
    );
  }
  return value;
};

/**
 * Resolve a user supplied retry policy into a fully populated one.
 *
 * Retries are opt-in: returns `undefined` (disabled) when `retry` is omitted or
 * `false`. `true` enables the built-in policy; an object enables it with the
 * provided overrides.
 *
 * @throws TypeError if an override is outside the domain documented on
 *   {@link RetryPolicy}.
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
    maxAttempts:
      retry.maxAttempts !== undefined
        ? checkedAttempts(retry.maxAttempts)
        : DEFAULT_RETRY_POLICY.maxAttempts,
    initialInterval:
      retry.initialInterval !== undefined
        ? checkedInterval(
            "initialInterval",
            millisOrDurationToMillis(retry.initialInterval)
          )
        : DEFAULT_RETRY_POLICY.initialInterval,
    maxInterval:
      retry.maxInterval !== undefined
        ? checkedInterval(
            "maxInterval",
            millisOrDurationToMillis(retry.maxInterval)
          )
        : DEFAULT_RETRY_POLICY.maxInterval,
    exponentiationFactor:
      retry.exponentiationFactor !== undefined
        ? checkedFactor(retry.exponentiationFactor)
        : DEFAULT_RETRY_POLICY.exponentiationFactor,
    shouldRetry: retry.shouldRetry,
  };
}

/** Whether an HTTP response status warrants a retry. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/**
 * Set by the ingress on every response that carries an invocation's own outcome.
 * Its presence separates "the invocation ended this way" from "the ingress could
 * not answer": a handler's terminal failure surfaces with the failure's own HTTP
 * status, which may well be a `5xx`.
 */
const INVOCATION_ID_HEADER = "x-restate-id";

/**
 * The built-in retry decision: retry network errors, HTTP `429`, and HTTP
 * `5xx`. Exported so a custom {@link RetryPolicy.shouldRetry} can compose with
 * it rather than reimplement it.
 *
 * A response identifying an invocation is never retried, whatever its status —
 * the ingress reached the invocation and reported its outcome, and asking again
 * cannot make a terminal failure any less terminal.
 */
export function defaultShouldRetry(failure: RetryFailure): boolean {
  if (failure.kind === "network") {
    return true;
  }
  if (failure.headers.has(INVOCATION_ID_HEADER)) {
    return false;
  }
  return isRetryableStatus(failure.status);
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
  const exp =
    policy.initialInterval * Math.pow(policy.exponentiationFactor, attempt);
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
