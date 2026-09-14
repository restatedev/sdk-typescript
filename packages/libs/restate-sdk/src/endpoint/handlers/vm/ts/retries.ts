/*
 * Copyright (c) 2023-2025 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

/**
 * Retry policies, mirrors `retries.rs` of the shared core.
 *
 * Durations are expressed in milliseconds. `Infinity` represents the Rust
 * `Duration::MAX` saturation value.
 */

import type { EntryRetryInfo } from "./types.js";

/** What to do when a `RetryPolicy` runs out of attempts or duration. */
export enum OnMaxAttempts {
  /** Convert the retryable failure into a terminal failure on the run handle. */
  FailAsTerminal,
  /** Pause the invocation instead of failing it. Requires service protocol V7 or newer. */
  Pause,
}

export type RetryPolicy =
  | { readonly type: "infinite" }
  | { readonly type: "none" }
  | {
      readonly type: "fixedDelay";
      /** Interval between retries (millis). If undefined, the runtime will provide one based on the invoker retry policy. */
      readonly interval?: number;
      readonly maxAttempts?: number;
      /** millis */
      readonly maxDuration?: number;
      readonly onMaxAttempts: OnMaxAttempts;
    }
  | {
      readonly type: "exponential";
      /** millis */
      readonly initialInterval: number;
      readonly factor: number;
      /** millis */
      readonly maxInterval?: number;
      readonly maxAttempts?: number;
      /** millis */
      readonly maxDuration?: number;
      readonly onMaxAttempts: OnMaxAttempts;
    };

export const RETRY_POLICY_INFINITE: RetryPolicy = { type: "infinite" };
export const RETRY_POLICY_NONE: RetryPolicy = { type: "none" };

export type NextRetry =
  | { readonly type: "retry"; readonly interval?: number }
  | { readonly type: "failAsTerminal" }
  | { readonly type: "pause" };

export function shouldPauseOnMaxAttempts(policy: RetryPolicy): boolean {
  return (
    (policy.type === "fixedDelay" || policy.type === "exponential") &&
    policy.onMaxAttempts === OnMaxAttempts.Pause
  );
}

function reachedBound(
  maxAttempts: number | undefined,
  maxDuration: number | undefined,
  retryInfo: EntryRetryInfo
): boolean {
  return (
    (maxAttempts !== undefined && maxAttempts <= retryInfo.retryCount) ||
    (maxDuration !== undefined && maxDuration <= retryInfo.retryLoopDuration)
  );
}

// 2^64: `Duration::try_from_secs_f32` fails for any value >= this
const DURATION_OVERFLOW_SECS = 18446744073709551616;

export function nextRetry(
  policy: RetryPolicy,
  retryInfo: EntryRetryInfo
): NextRetry {
  switch (policy.type) {
    case "infinite":
      return { type: "retry", interval: undefined };
    case "none":
      return { type: "failAsTerminal" };
    case "fixedDelay": {
      if (reachedBound(policy.maxAttempts, policy.maxDuration, retryInfo)) {
        return policy.onMaxAttempts === OnMaxAttempts.FailAsTerminal
          ? { type: "failAsTerminal" }
          : { type: "pause" };
      }
      return { type: "retry", interval: policy.interval };
    }
    case "exponential": {
      if (reachedBound(policy.maxAttempts, policy.maxDuration, retryInfo)) {
        return policy.onMaxAttempts === OnMaxAttempts.FailAsTerminal
          ? { type: "failAsTerminal" }
          : { type: "pause" };
      }

      const maxInterval = policy.maxInterval ?? Infinity;

      // Next interval in the backoff sequence:
      // initial_interval * factor^(retry_count - 1)
      // Computed in f32 like the Rust implementation, saturating on overflow.
      const exponent = Math.max(0, retryInfo.retryCount - 1);
      const initialSecs = Math.fround(policy.initialInterval / 1000);
      const factor = Math.fround(policy.factor);
      const secs = Math.fround(
        initialSecs * Math.fround(Math.pow(factor, exponent))
      );
      if (
        !Number.isFinite(secs) ||
        Number.isNaN(secs) ||
        secs < 0 ||
        secs >= DURATION_OVERFLOW_SECS
      ) {
        // Overflow, return max_interval instead.
        return { type: "retry", interval: maxInterval };
      }
      // Duration::try_from_secs_f32 keeps nanosecond precision, `as_millis` truncates.
      const nextIntervalMillis = Math.floor(Math.round(secs * 1e9) / 1e6);
      return {
        type: "retry",
        interval: Math.min(maxInterval, nextIntervalMillis),
      };
    }
  }
}
