import type { Request } from "./context.js";

// ---- Result types ----

export type AttemptResult =
  | { type: "success" }
  | { type: "retryableError"; error: Error }
  | { type: "terminalError"; error: Error };

// ---- Hook context ----

export interface HookContext {
  serviceName: string;
  handlerName: string;
  key?: string;
  invocationId: string;
  request: Request;
}

// ---- Interceptor ----
// Wraps real executions only (skipped during replay).
// Call `next()` to proceed. Code before/after `next()`
// runs around the operation. Side-effect only - return
// value is ignored by the SDK.

export interface Interceptor {
  handler?: (next: () => Promise<void>) => Promise<void>;
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
