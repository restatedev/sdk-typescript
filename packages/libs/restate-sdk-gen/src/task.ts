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

// Task<T>
// =============================================================================
//
// The handle returned by `spawn`. A `Task<T>` is a `Future<T>` (yieldable,
// composable into all/race/any/allSettled exactly like any other Future)
// plus a control method: `interrupt(err?)`, which throws `err` into the
// spawned routine at its next yield point and aborts its in-flight `run`
// I/O.
//
// Only `spawn` produces a Task — combinator results (race/all/…) stay plain
// Future<T>, since their journal fast path has no fiber to target and their
// fallback runs SDK-authored loop code with no user-owned try/catch.

import type { Future } from "./future.js";

/**
 * A handle to a spawned routine: its `Future<T>` plus `interrupt`.
 */
export interface Task<T> extends Future<T> {
  /**
   * Throw `err` into the spawned routine at its next yield point, and
   * abort its in-flight `run` I/O. `err` is delivered verbatim — the
   * routine's own try/catch may catch and recover (interrupt is
   * swallowable). When `err` is omitted, an {@link InterruptedError} is
   * thrown instead.
   *
   * Interrupt only affects a still-running routine: interrupting one
   * that has already settled is a no-op. Under the default
   * `onMainExit: "abandon"`, interrupting a child and then returning
   * from the main operation delivers nothing — the scheduler stops
   * before the child is driven. To run the child's `catch`/`finally`,
   * interrupt then `yield*` the task (interrupt-then-join).
   *
   * Call from within the workflow (an advancing fiber), so the delivery
   * point is deterministic across replay.
   */
  interrupt(err?: unknown): void;
}

/**
 * The default error thrown by `interrupt()` when no explicit error is
 * given. A plain `Error` (not a `TerminalError`) — interrupt imposes no
 * blast radius of its own; if you want an uncaught interrupt to fail the
 * invocation terminally, pass a `TerminalError` to `interrupt(err)`.
 */
export class InterruptedError extends Error {
  constructor(message = "Task interrupted") {
    super(message);
    this.name = "InterruptedError";
  }
}

/**
 * Augment a spawned routine's Future with `interrupt`, producing a Task.
 * Takes a plain `(err) => void` callback (the fiber's `interrupt`) rather
 * than the Fiber itself, so this module stays free of scheduler/fiber
 * imports. `Object.assign` mutates and returns the same Future object —
 * its `[Symbol.iterator]` and symbol-keyed backing are untouched, so the
 * Task remains fully yieldable and composable.
 */
export function makeTask<T>(
  future: Future<T>,
  interruptFiber: (err: unknown) => void
): Task<T> {
  const interrupt = (err?: unknown): void =>
    interruptFiber(err === undefined ? new InterruptedError() : err);
  return Object.assign(future as object, { interrupt }) as Task<T>;
}
