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
 * - Cannot modify the handler's input or return value (`void` signature).
 * - Skipped during journal replay — only fires for real executions.
 * - `next()` must be called exactly once.
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
  /** Wraps the entire handler invocation. */
  handler?: (next: () => Promise<void>) => Promise<void>;
  /** Wraps each `ctx.run()` call. `name` is the run's label. */
  run?: (name: string, next: () => Promise<void>) => Promise<void>;
}

// ---- Listener ----
// Observes lifecycle events. Fires on every attempt,
// including replay failures. Cannot affect execution.

export interface Listener {
  attemptEnd?: (result: AttemptResult) => void;
}

// ---- Hooks ----

export interface Hooks {
  interceptor?: Interceptor;
  listener?: Listener;
}

// ---- Provider ----
// Factory called once per invocation. Receives invocation
// context, returns hooks for that invocation's lifetime.

export type HooksProvider = (ctx: HookContext) => Hooks;
