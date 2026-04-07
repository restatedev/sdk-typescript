import type { Request } from "./context.js";

// ---- Result types ----

export type AttemptResult =
  | { type: "success" }
  | { type: "retryableError"; error: Error }
  | { type: "terminalError"; error: Error }
  | { type: "abandoned" };

// ---- Hook context ----

export interface HookContext {
  serviceName: string;
  handlerName: string;
  key?: string;
  invocationId: string;
  request: Request;
}

// ---- Interceptor ----

/**
 * Interceptors wrap handler and ctx.run() execution. They are part of the
 * invocation — anything that happens inside them (including after `next()`)
 * affects the invocation outcome.
 *
 * - Errors thrown at any point (before or after `next()`) will fail or retry the invocation.
 * - `next()` can reject with {@link AttemptAbandonedError} when the SDK abandons the current
 *   attempt and unwinds the interceptor stack. This is control flow for attempt boundaries
 *   (for example suspension), not necessarily an invocation failure;
 *   do any cleanup you need and rethrow.
 * - Cannot modify the handler's input or return value (`void` signature).
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

// ---- Listener ----

/**
 * Observers for lifecycle events. Cannot affect execution.
 */
export interface Listener {
  /**
   * Called when an attempt ends. Fires for every outcome: success,
   * retryable error, terminal error, or abandoned (suspension).
   * Errors thrown here are swallowed and logged — they never affect the invocation.
   */
  attemptEnd?: (result: AttemptResult) => void;
}

// ---- Hooks ----

export interface Hooks {
  interceptor?: Interceptor;
  listener?: Listener;
}

// ---- Provider ----

/**
 * Factory called on every attempt. Receives invocation context, returns
 * hooks for that attempt's lifetime. Each attempt gets a fresh call.
 */
export type HooksProvider = (ctx: HookContext) => Hooks;
