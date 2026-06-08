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

// Linked AbortControllers.
// =============================================================================
//
// A child AbortController whose signal aborts when its parent fires.
// Used at two levels: the scheduler links its controller to the SDK's
// attempt signal, and each fiber links its run-closure controller to the
// scheduler's current signal — so invocation cancellation / attempt-end
// cascade into in-flight `run` closures, while a targeted `interrupt`
// can abort just one fiber's controller.

/**
 * Create a controller whose signal is a child of `parent`: pre-aborted
 * if the parent has already fired, otherwise aborted the moment it does.
 *
 * The subscription uses `{ once, signal: c.signal }` so it self-detaches
 * on either exit — when the parent fires (`once`) or when this controller
 * is aborted by some other path (`signal`). A controller that is retired
 * and replaced therefore drops its listener immediately, so at most one
 * listener per child lives on the parent at a time — no accumulation
 * across cancel/recover or interrupt/recover cycles.
 */
export function linkAbortController(parent: AbortSignal): AbortController {
  const c = new AbortController();
  if (parent.aborted) {
    c.abort(parent.reason);
  } else {
    parent.addEventListener("abort", () => c.abort(parent.reason), {
      once: true,
      signal: c.signal,
    });
  }
  return c;
}
