// Shared fake external services for the tutorial.
//
// These stand in for real APIs / databases / queues. Behavior is just
// enough to make the workflows interesting (occasional failure, settable
// latency, deterministic sequencing) without dragging in real
// infrastructure.

import * as restate from "@restatedev/restate-sdk";

export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Stand-in for DOMException("Aborted", "AbortError") — same runtime
// behavior, no DOM-lib dependency in tsc.
function abortError(message = "Aborted"): Error {
  const e = new Error(message);
  e.name = "AbortError";
  return e;
}

// ---------------------------------------------------------------------------
// fake HTTP fetches — used by basics + concurrency demos
// ---------------------------------------------------------------------------

export async function fetchA(): Promise<string> {
  await wait(80);
  return "alpha";
}

export async function fetchB(): Promise<string> {
  await wait(120);
  return "bravo";
}

export async function fetchFast(): Promise<string> {
  await wait(30);
  return "fast-result";
}

export async function fetchSlow(): Promise<string> {
  await wait(300);
  return "slow-result";
}

// A long-running fetch-like call that honors an AbortSignal. Mirrors
// real `fetch` behavior: when the signal aborts, it rejects with
// AbortError. Used to show how `ops.run` closures plumb their signal
// into cancellable I/O so that invocation cancel terminates in-flight
// syscalls promptly instead of waiting for them to finish.
export async function slowFetch(
  url: string,
  signal: AbortSignal,
  ms = 10_000
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError("Aborted"));
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve(`fetched: ${url}`);
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(abortError("Aborted"));
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    };
    signal.addEventListener("abort", onAbort);
  });
}

// A fake fetch that fails the first `failTimes` calls and then succeeds.
// Used by the retry demo. State is keyed by url so concurrent demos don't
// interfere; resetting state between invocations is fine — for teaching.
const flakyState = new Map<string, number>();

export async function flakyFetch(url: string, failTimes = 2): Promise<string> {
  const seen = flakyState.get(url) ?? 0;
  flakyState.set(url, seen + 1);
  await wait(40);
  if (seen < failTimes) {
    // Non-terminal: SDK retries with backoff.
    throw new Error(`flaky ${url}: attempt ${seen + 1} failed`);
  }
  return `data-from-${url}`;
}

// ---------------------------------------------------------------------------
// fake inventory / payments — used by the saga demo
// ---------------------------------------------------------------------------

export async function reserveItem(itemId: string): Promise<{ id: string }> {
  await wait(50);
  if (itemId === "out-of-stock") {
    throw new restate.TerminalError(`item ${itemId} unavailable`);
  }
  return { id: `res-${itemId}` };
}

export async function chargeCard(
  amount: number,
  cardToken: string
): Promise<{ id: string }> {
  await wait(50);
  if (amount > 1_000_000) {
    throw new restate.TerminalError(`amount ${amount} exceeds limit`);
  }
  if (cardToken === "tok_decline") {
    throw new restate.TerminalError("card declined");
  }
  return { id: `chg-${cardToken}` };
}

export async function createOrder(
  reservationId: string,
  chargeId: string
): Promise<string> {
  await wait(20);
  return `order-${reservationId}-${chargeId}`;
}

export async function releaseItem(reservationId: string): Promise<void> {
  await wait(20);
  console.log(`compensation: released reservation ${reservationId}`);
}

// ---------------------------------------------------------------------------
// fake job tracker — used by the polling / cancel demos
// ---------------------------------------------------------------------------

export type JobStatus =
  | { state: "pending" }
  | { state: "done"; result: string }
  | { state: "failed"; reason: string };

const jobs = new Map<string, JobStatus>();

function ensureStarted(id: string): void {
  if (jobs.has(id)) return;
  jobs.set(id, { state: "pending" });
  // Fake job completes after ~3 seconds. Use the id "slow" to simulate
  // a job that doesn't finish within typical budgets.
  if (id !== "slow") {
    setTimeout(
      () => jobs.set(id, { state: "done", result: `result-for-${id}` }),
      3_000
    );
  }
}

export async function getJob(id: string): Promise<JobStatus> {
  ensureStarted(id);
  return jobs.get(id)!;
}
