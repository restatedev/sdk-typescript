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

// Shared value types used across the scheduler/fiber boundary. Live in
// their own module to break import cycles between Future, Fiber, and
// Scheduler.

import type { Awaitable } from "./awaitable.js";

export type Settled = { ok: true; v: unknown } | { ok: false; e: unknown };

/**
 * "This fiber wants to be told when this promise settles, and here's
 * what to do about it." For a normal yield over a journal future,
 * fire = (s) => fiber.wake(s) — the default. For AwaitAny, fire is a
 * closure that checks a `won` flag and wakes the fiber with
 * {index, settled}. Same mechanism, different callbacks.
 */
export type PromiseSource = {
  promise: Awaitable<unknown>;
  fire: (s: Settled) => void;
};

/**
 * Callbacks invoked when a fiber settles. Plain awaits push
 * (s) => fiber.wake(s); AwaitAny pushes a closure that checks `won`
 * and wakes the fiber with {index, settled}. Same shape as
 * PromiseSource.fire, just for fiber-completion sources rather than
 * promise sources.
 */
export type Waiter = (settled: Settled) => void;
