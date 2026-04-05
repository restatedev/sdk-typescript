import * as restate from "@restatedev/restate-sdk";
import type {
  HooksProvider,
  AttemptResult,
  HookContext,
} from "@restatedev/restate-sdk";

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

export type HookLevel = "handler" | "service" | "endpoint";

export function withHooksAt(level: HookLevel, hooks: HooksProvider[]) {
  return level === "handler"
    ? { handlerHooks: hooks }
    : level === "service"
      ? { serviceHooks: hooks }
      : {};
}

export function createService<T>(opts: {
  name: string;
  handlerHooks?: HooksProvider[];
  serviceHooks?: HooksProvider[];
  handler: (ctx: restate.Context, input: string) => Promise<T>;
  options?: {
    retryPolicy?: {
      initialInterval?: number;
      maxAttempts?: number;
      onMaxAttempts?: string;
    };
    inactivityTimeout?: number;
  };
}) {
  const serviceOpts: Record<string, unknown> = { ...opts.options };
  if (opts.serviceHooks) serviceOpts.hooks = opts.serviceHooks;

  if (opts.handlerHooks) {
    return restate.service({
      name: opts.name,
      handlers: {
        invoke: restate.createServiceHandler(
          { hooks: opts.handlerHooks },
          opts.handler
        ),
      },
      ...(Object.keys(serviceOpts).length ? { options: serviceOpts } : {}),
    });
  }

  return restate.service({
    name: opts.name,
    handlers: { invoke: opts.handler },
    ...(Object.keys(serviceOpts).length ? { options: serviceOpts } : {}),
  });
}

// ---------------------------------------------------------------------------
// Per-invocation event capture — keyed by invocationId, safe under parallel
// ---------------------------------------------------------------------------

const invocationEvents = new Map<string, string[]>();

export function pushEvent(invocationId: string, event: string) {
  let events = invocationEvents.get(invocationId);
  if (!events) {
    events = [];
    invocationEvents.set(invocationId, events);
  }
  events.push(event);
}

export function getEvents(invocationId: string): string[] {
  return invocationEvents.get(invocationId) ?? [];
}

// ---------------------------------------------------------------------------
// Per-invocation AttemptResult capture
// ---------------------------------------------------------------------------

const capturedResults = new Map<string, AttemptResult[]>();

function pushResult(invocationId: string, result: AttemptResult) {
  let results = capturedResults.get(invocationId);
  if (!results) {
    results = [];
    capturedResults.set(invocationId, results);
  }
  results.push(result);
}

export function getResults(invocationId: string): AttemptResult[] {
  return capturedResults.get(invocationId) ?? [];
}

// ---------------------------------------------------------------------------
// Per-invocation context capture
// ---------------------------------------------------------------------------

const capturedContexts = new Map<string, HookContext>();

export function captureContext(): HooksProvider {
  return (ctx: HookContext) => {
    capturedContexts.set(ctx.invocationId, ctx);
    return {};
  };
}

export function getCapturedContext(
  invocationId: string
): HookContext | undefined {
  return capturedContexts.get(invocationId);
}

// ---------------------------------------------------------------------------
// Attempt tracking — used by retry test handlers
// ---------------------------------------------------------------------------

const attemptCounts = new Map<string, number>();

export function nextAttempt(invocationId: string): number {
  const n = (attemptCounts.get(invocationId) ?? 0) + 1;
  attemptCounts.set(invocationId, n);
  return n;
}

// ---------------------------------------------------------------------------
// Hook factories
// ---------------------------------------------------------------------------

export function recordHookEvents(tag = "hook"): HooksProvider {
  return (ctx: HookContext) => {
    const id = ctx.invocationId;
    return {
      interceptor: {
        handler: async (next) => {
          pushEvent(id, `${tag}:handler:before`);
          try {
            await next();
          } finally {
            pushEvent(id, `${tag}:handler:after`);
          }
        },
        run: async (name, next) => {
          pushEvent(id, `${tag}:run:${name}:before`);
          try {
            await next();
            pushEvent(id, `${tag}:run:${name}:after`);
          } catch (e) {
            pushEvent(id, `${tag}:run:${name}:error`);
            throw e;
          }
        },
      },
      listener: {
        attemptEnd: (result: AttemptResult) => {
          pushEvent(id, `${tag}:attemptEnd:${result.type}`);
          pushResult(id, result);
        },
      },
    };
  };
}

/** Hook provider that throws a retryable error on the first attempt */
export function throwOnFirstHookProviderCall(
  targetService: string
): HooksProvider {
  return (ctx: HookContext) => {
    if (ctx.serviceName === targetService) {
      if (nextAttempt(ctx.invocationId) === 1)
        throw new Error("provider retryable error");
    }
    return {};
  };
}

/** Hook whose handler interceptor throws a retryable error on the first attempt */
export function throwOnFirstHandlerIntercept(
  targetService: string
): HooksProvider {
  return (ctx: HookContext) => {
    if (ctx.serviceName !== targetService) return {};
    return {
      interceptor: {
        handler: async (next) => {
          if (nextAttempt(ctx.invocationId) === 1)
            throw new Error("interceptor retryable error");
          await next();
        },
      },
    };
  };
}

/** Hook whose run interceptor throws a retryable error on the first attempt */
export function throwOnFirstRunIntercept(targetService: string): HooksProvider {
  return (ctx: HookContext) => {
    if (ctx.serviceName !== targetService) return {};
    return {
      interceptor: {
        run: async (_name, next) => {
          if (nextAttempt(ctx.invocationId) === 1)
            throw new Error("run interceptor retryable error");
          await next();
        },
      },
    };
  };
}

/** Hook whose handler interceptor throws a terminal error */
export function throwTerminalOnHandlerIntercept(
  targetService: string
): HooksProvider {
  return (ctx: HookContext) => {
    if (ctx.serviceName !== targetService) return {};
    return {
      interceptor: {
        handler: async (next) => {
          await next();
          throw new restate.TerminalError("interceptor terminal error");
        },
      },
    };
  };
}

/** Hook whose run interceptor throws a terminal error */
export function throwTerminalOnRunIntercept(
  targetService: string
): HooksProvider {
  return (ctx: HookContext) => {
    if (ctx.serviceName !== targetService) return {};
    return {
      interceptor: {
        run: async (_name, next) => {
          await next();
          throw new restate.TerminalError("run interceptor terminal error");
        },
      },
    };
  };
}

/** Hook whose run interceptor catches and swallows errors from next() */
export function swallowRunError(targetService: string): HooksProvider {
  return (ctx: HookContext) => {
    if (ctx.serviceName !== targetService) return {};
    return {
      interceptor: {
        run: async (_name, next) => {
          try {
            await next();
          } catch {
            // swallowed
          }
        },
      },
    };
  };
}

/** Listener that always throws for the target service — errors should be swallowed by the SDK */
export function throwOnAttemptEnd(targetService: string): HooksProvider {
  return (ctx: HookContext) => {
    if (ctx.serviceName !== targetService) return {};
    return {
      listener: {
        attemptEnd: () => {
          throw new Error("listener error — should be swallowed");
        },
      },
    };
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export async function invokeExpectingError(
  fn: () => PromiseLike<unknown>
): Promise<{ events: string[]; invocationId?: string }> {
  const idsBefore = new Set(invocationEvents.keys());
  try {
    await fn();
  } catch {
    // expected
  }
  for (const [id, events] of invocationEvents) {
    if (!idsBefore.has(id)) return { events, invocationId: id };
  }
  return { events: [] };
}

export const fastRetry = { retryPolicy: { initialInterval: 10 } };

/**
 * Query the Restate runtime for the outcome of an invocation.
 * Returns "succeeded", "failed", or the raw status if not completed.
 */
export async function getInvocationOutcome(
  adminUrl: string,
  invocationId: string
): Promise<string> {
  const res = await fetch(`${adminUrl}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      query: `SELECT status, completion_result FROM sys_invocation WHERE id = '${invocationId}'`,
    }),
  });
  const json = (await res.json()) as {
    rows: { status: string; completion_result: string | null }[];
  };
  const row = json.rows[0];
  if (!row) return "not_found";
  if (row.status !== "completed") return row.status;
  return row.completion_result === "success" ? "succeeded" : "failed";
}
