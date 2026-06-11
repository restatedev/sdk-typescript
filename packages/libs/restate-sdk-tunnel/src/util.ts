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

// Small abort-aware async utilities shared by the engine.

/** Sleep that wakes early (resolving) when the signal aborts. */
export function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Race a promise against a signal: resolves `null` the moment the signal
 * aborts, otherwise passes the promise's result through (rejections
 * propagate). The abort listener is removed when the race settles, so
 * repeated calls against a long-lived signal don't accumulate listeners.
 */
export async function raceAbortable<T>(
  promise: Promise<T>,
  signal: AbortSignal
): Promise<T | null> {
  if (signal.aborted) return null;
  let onAbort!: () => void;
  const aborted = new Promise<null>((resolve) => {
    onAbort = () => resolve(null);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}
