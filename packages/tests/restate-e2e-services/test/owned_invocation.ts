// Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
//
// This file is part of the Restate e2e tests,
// which are released under the MIT license.
//
// You can find a copy of the license in file LICENSE in the root
// directory of this repository or package, or at
// https://github.com/restatedev/e2e/blob/main/LICENSE

import { setTimeout as sleep } from "node:timers/promises";
import { expect } from "vitest";
import { waitForInvocationOutcome } from "./hooks_utils.js";

// Helpers for tests that create an invocation and must not leave it running.
// Every request made here carries an AbortSignal, so a stalled server fails the
// test within the budgets below instead of hanging it, and cleanup still has
// time to run before the test timeout.

/** One admin API request, including its response body. */
export const ADMIN_REQUEST_TIMEOUT_MS = 2_000;
/** Sending an invocation through the ingress. */
export const SEND_TIMEOUT_MS = 5_000;
/** Waiting for an invocation result through the ingress attach endpoint. */
export const RESULT_TIMEOUT_MS = 10_000;
/** Polling the admin API for the recorded invocation outcome. */
export const OUTCOME_TIMEOUT_MS = 5_000;
/** Waiting for the server to record retries of an invocation. */
export const RETRY_WAIT_MS = 15_000;
/** Killing an owned invocation and reading back that it completed. */
export const CLEANUP_TIMEOUT_MS = 8_000;

const CLEANUP_POLL_INTERVAL_MS = 200;
const MARGIN_MS = 5_000;

/** Vitest timeout for a test that sends and then uses {@link expectTerminalFailure}. */
export const TERMINAL_TEST_TIMEOUT_MS =
  SEND_TIMEOUT_MS +
  RESULT_TIMEOUT_MS +
  OUTCOME_TIMEOUT_MS +
  ADMIN_REQUEST_TIMEOUT_MS +
  CLEANUP_TIMEOUT_MS +
  MARGIN_MS;

/** Vitest timeout for a test that sends, uses {@link waitForRetries}, and ends the invocation. */
export const RETRY_TEST_TIMEOUT_MS =
  SEND_TIMEOUT_MS +
  RETRY_WAIT_MS +
  2 * ADMIN_REQUEST_TIMEOUT_MS +
  CLEANUP_TIMEOUT_MS +
  MARGIN_MS;

export interface InvocationAttempts {
  status: string;
  retryCount: number;
  lastFailure: string | null;
}

function boundedSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(ADMIN_REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([timeout, signal]) : timeout;
}

export async function getInvocationAttempts(
  adminUrl: string,
  invocationId: string,
  signal?: AbortSignal
): Promise<InvocationAttempts> {
  const res = await fetch(`${adminUrl}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      query: `SELECT status, retry_count, last_failure FROM sys_invocation WHERE id = '${invocationId}'`,
    }),
    signal: boundedSignal(signal),
  });
  if (!res.ok) {
    throw new Error(
      `Admin query for ${invocationId} failed: ${res.status} ${await res.text()}`
    );
  }
  const json = (await res.json()) as {
    rows: {
      status: string;
      retry_count: number | null;
      last_failure: string | null;
    }[];
  };
  const row = json.rows[0];
  if (!row) return { status: "not_found", retryCount: 0, lastFailure: null };
  return {
    status: row.status,
    retryCount: row.retry_count ?? 0,
    lastFailure: row.last_failure,
  };
}

export async function killInvocation(
  adminUrl: string,
  invocationId: string,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${adminUrl}/invocations/${invocationId}/kill`, {
    method: "PATCH",
    headers: { Accept: "application/json" },
    signal: boundedSignal(signal),
  });
  const body = await res.text();
  if (!res.ok && res.status !== 404) {
    throw new Error(
      `Failed to kill invocation ${invocationId}: ${res.status} ${body}`
    );
  }
}

/**
 * Waits for the invocation result through the same ingress attach endpoint that
 * `ingress.result()` uses, bounded by an AbortSignal (including the body read):
 * a handler that keeps being retried never produces a result.
 */
export async function attachWithin(
  ingressUrl: string,
  invocationId: string,
  timeoutMs: number
): Promise<{ status: number; body: string }> {
  const signal = AbortSignal.timeout(timeoutMs);
  const res = await fetch(
    `${ingressUrl}/restate/invocation/${invocationId}/attach`,
    { signal }
  );
  return { status: res.status, body: await res.text() };
}

/**
 * Ends an invocation a test created: kills it unless it already completed, then
 * reads back that it reached the completed state. A successful kill request
 * alone is not accepted as proof. Everything shares one deadline; if it passes,
 * the invocation's state is reported as unverified.
 */
export async function ensureInvocationEnded(
  adminUrl: string,
  invocationId: string,
  timeoutMs: number = CLEANUP_TIMEOUT_MS
): Promise<void> {
  const deadline = AbortSignal.timeout(timeoutMs);
  let lastState = "unknown";
  try {
    let attempts = await getInvocationAttempts(
      adminUrl,
      invocationId,
      deadline
    );
    lastState = attempts.status;
    if (attempts.status === "not_found") {
      throw new Error(`invocation ${invocationId} was not found`);
    }
    if (attempts.status !== "completed") {
      await killInvocation(adminUrl, invocationId, deadline);
    }
    while (attempts.status !== "completed") {
      await sleep(CLEANUP_POLL_INTERVAL_MS, undefined, { signal: deadline });
      attempts = await getInvocationAttempts(adminUrl, invocationId, deadline);
      lastState = attempts.status;
    }
  } catch (e) {
    throw new Error(
      `could not verify that invocation ${invocationId} ended within ${timeoutMs} ms (last observed state: ${lastState})`,
      { cause: e }
    );
  }
}

/**
 * Runs `body` for an invocation the test owns. If `body` fails, the invocation
 * is ended (see {@link ensureInvocationEnded}) and the original failure is
 * rethrown. If cleanup cannot be verified, that is appended to the original
 * error message rather than replacing the error. With `endAfterwards`, the
 * invocation is also ended after `body` succeeds.
 */
export async function withOwnedInvocation<T>(
  adminUrl: string,
  invocationId: string,
  body: () => Promise<T>,
  options?: { endAfterwards?: boolean; cleanupTimeoutMs?: number }
): Promise<T> {
  let result: T;
  try {
    result = await body();
  } catch (original) {
    try {
      await ensureInvocationEnded(
        adminUrl,
        invocationId,
        options?.cleanupTimeoutMs
      );
    } catch (cleanupError) {
      const note = `[cleanup: ${
        cleanupError instanceof Error
          ? cleanupError.message
          : String(cleanupError)
      }; the invocation may still be running]`;
      if (original instanceof Error) {
        original.message += `\n${note}`;
      } else {
        console.warn(note);
      }
    }
    throw original;
  }
  if (options?.endAfterwards) {
    await ensureInvocationEnded(
      adminUrl,
      invocationId,
      options.cleanupTimeoutMs
    );
  }
  return result;
}

/**
 * Waits until the server has recorded at least `minRetryCount` attempts of an
 * invocation that is still not completed, and returns the last observation.
 */
export async function waitForRetries(
  adminUrl: string,
  invocationId: string,
  minRetryCount: number,
  timeoutMs: number = RETRY_WAIT_MS
): Promise<InvocationAttempts> {
  // Aborted once this call settles, so no poll check outlives it.
  const owned = new AbortController();
  try {
    await expect
      .poll(
        async () => {
          const attempts = await getInvocationAttempts(
            adminUrl,
            invocationId,
            owned.signal
          );
          return (
            attempts.retryCount >= minRetryCount &&
            attempts.status !== "completed"
          );
        },
        { timeout: timeoutMs, interval: 200 }
      )
      .toBe(true);
    return await getInvocationAttempts(adminUrl, invocationId, owned.signal);
  } finally {
    owned.abort();
  }
}

/**
 * Asserts that an owned invocation ends with the given terminal failure on its
 * first attempt: the ingress reports the failure, the journal output carries the
 * message, and no transient error (that is, no retry) was ever recorded.
 */
export async function expectTerminalFailure(
  urls: { adminUrl: string; ingressUrl: string },
  invocationId: string,
  expectedMessage: string
): Promise<void> {
  await withOwnedInvocation(urls.adminUrl, invocationId, async () => {
    const attached = await attachWithin(
      urls.ingressUrl,
      invocationId,
      RESULT_TIMEOUT_MS
    );
    expect(attached.status).toBeGreaterThanOrEqual(400);
    expect(attached.body).toContain(expectedMessage);
    const outcome = await waitForInvocationOutcome(
      urls.adminUrl,
      invocationId,
      {
        status: "failed",
        journalOutput: { failure: { message: expectedMessage } },
      },
      {
        timeout: OUTCOME_TIMEOUT_MS,
        interval: 100,
        requestTimeout: ADMIN_REQUEST_TIMEOUT_MS,
      }
    );
    expect(outcome.transientErrors).toBeUndefined();
  });
}
