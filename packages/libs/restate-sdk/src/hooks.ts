import type { Request } from "./context.js";

// ---- Interceptor ----

/**
 * Interceptors wrap handler and ctx.run() execution. They are part of the
 * invocation — anything that happens inside them (including after `next()`)
 * affects the invocation outcome.
 *
 * ## Error behavior
 *
 * Errors thrown at any point (before or after `next()`) affect the invocation:
 *
 * - **{@link TerminalError}** — the invocation **fails immediately**, no retry.
 * - **Any other error** — Restate **retries** the invocation.
 * - On suspension or pause, `next()` also rejects with an error. This does not
 *   mean the invocation failed — the attempt is simply ending. Do any cleanup
 *   you need and rethrow.
 *
 * ## Output
 *
 * Interceptors **cannot alter the handler's return value**. The `void` signature
 * means the interceptor observes execution but does not transform its result.
 *
 * ## Rules
 *
 * - `next()` must be called exactly once.
 *
 * ## When interceptors fire
 *
 * - `handler` fires on every attempt.
 * - `run` fires when the `ctx.run()` closure executes. If the result is
 *   already in the journal, the closure is skipped and so is the interceptor.
 *
 * @example
 * ```ts
 * interceptor: {
 *   handler: async (next) => {
 *     console.log("before handler");
 *     await next();
 *     console.log("after handler");
 *   },
 *   run: async (name, next) => {
 *     const span = tracer.startSpan(name);
 *     try {
 *       await next();
 *     } catch (e) {
 *       span.recordException(e);
 *       throw e;
 *     } finally {
 *       span.end();
 *     }
 *   },
 * }
 * ```
 */
export interface Interceptor {
  /** Wraps the entire handler invocation. Fires on every attempt. */
  handler?: (next: () => Promise<void>) => Promise<void>;
  /**
   * Wraps each `ctx.run()` call. Only fires for runs that actually execute —
   * replayed runs (already in the journal) are skipped.
   * `name` is the run's label.
   */
  run?: (name: string, next: () => Promise<void>) => Promise<void>;
}

// ---- Hooks ----

export interface Hooks {
  interceptor?: Interceptor;
}

// ---- Provider ----

/**
 * Factory called on every attempt. Receives the invocation request,
 * returns hooks for that attempt's lifetime. Each attempt gets a fresh call.
 */
export type HooksProvider = (ctx: { request: Request }) => Hooks;
