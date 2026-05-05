// Synchronous current-fiber slot.
// =============================================================================
//
// A module-level pointer to the active `RestateOperations`, set on
// entry to `Fiber.advance()` and cleared in its `finally`. Free-standing
// API functions (`sleep`, `run`, `all`, …) read it to reach the
// scheduler/context without an explicit `ops` parameter.
//
// Why this is safe without AsyncLocalStorage: user generators yield —
// they do not `await`. `iterator.next()` returns control synchronously
// to `Fiber.advance`, so the slot is "owned" only during the synchronous
// span between `setCurrent` and `clearCurrent`. Concurrent `execute()`
// calls in the same Node process interleave only at scheduler-level
// `await` boundaries (the main-loop race), never in the middle of a
// fiber's sync body — Node never preempts sync JS.
//
// Failure mode: a free function called while no fiber is advancing
// (module init, an `ops.run` async closure that resolves later, a
// timer firing) reads `null` and throws. Loud and immediate; never
// silent corruption.
//
// The slot value is typed `unknown` here to avoid a circular import on
// `RestateOperations` (which itself imports the scheduler graph). Free
// functions cast back via the typed `currentOps()` helper that lives
// next to `RestateOperations`.

let CURRENT: unknown = null;

/**
 * Save the previous slot, install `value` as the current. Returns the
 * previous value so `clearCurrent` can restore it (supports nested
 * scheduler invocations on the same thread, even though we don't expect
 * any in production).
 */
export function setCurrent(value: unknown): unknown {
  const prev = CURRENT;
  CURRENT = value;
  return prev;
}

/** Restore a slot previously captured by `setCurrent`. */
export function clearCurrent(prev: unknown): void {
  CURRENT = prev;
}

/**
 * Read the slot, throwing if no fiber is currently advancing. Callers
 * cast the return type — the slot is intentionally `unknown` here so
 * this module stays free of cycles.
 */
export function getCurrent(): unknown {
  if (CURRENT === null) {
    throw new Error(
      "@restatedev/restate-sdk-gen: free-standing API called outside an active fiber. " +
        "Call from inside `execute(ctx, gen(function*() { ... }))`."
    );
  }
  return CURRENT;
}
