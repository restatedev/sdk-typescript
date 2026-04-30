// Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
//
// This file is part of the Restate e2e tests,
// which are released under the MIT license.
//
// You can find a copy of the license in file LICENSE in the root
// directory of this repository or package, or at
// https://github.com/restatedev/e2e/blob/main/LICENSE

import { AsyncLocalStorage } from "node:async_hooks";
import * as restate from "@restatedev/restate-sdk";
import type { HooksProvider } from "@restatedev/restate-sdk";
import { REGISTRY } from "./services.js";

export type HookLevel = "handler" | "service";

export type InvocationResult = {
  invocationId: string;
};

export type RequestSnapshot = {
  id: string;
  target: {
    service: string;
    handler: string;
    key?: string;
  };
};

export function withHooksAt(level: HookLevel, hooks: HooksProvider[]) {
  return level === "handler"
    ? { handlerHooks: hooks }
    : { serviceHooks: hooks };
}

function createService<T>(opts: {
  name: string;
  handlerHooks?: HooksProvider[];
  serviceHooks?: HooksProvider[];
  handler: (ctx: restate.Context, input: string) => Promise<T>;
  handlerOpts?: Record<string, unknown>;
  options?: {
    retryPolicy?: {
      initialInterval?: number;
      maxAttempts?: number;
      onMaxAttempts?: string;
    };
    inactivityTimeout?: number;
    abortTimeout?: number;
    asTerminalError?: (error: unknown) => restate.TerminalError | undefined;
  };
}) {
  const serviceOpts: Record<string, unknown> = { ...opts.options };
  if (opts.serviceHooks) serviceOpts.hooks = opts.serviceHooks;

  if (opts.handlerHooks || opts.handlerOpts) {
    return restate.service({
      name: opts.name,
      handlers: {
        invoke: restate.createServiceHandler(
          {
            ...(opts.handlerOpts ?? {}),
            ...(opts.handlerHooks ? { hooks: opts.handlerHooks } : {}),
          },
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

const invocationEvents = new Map<string, string[]>();
const capturedContexts = new Map<string, RequestSnapshot>();
const attemptCounts = new Map<string, number>();
const awakeableIds = new Map<string, string>();
const ksAttempts = new Map<string, number>();
const leakedMetadata = new Map<
  string,
  { commandType: string[]; commandIndex: string[] }
>();

function pushEvent(invocationId: string, event: string) {
  let events = invocationEvents.get(invocationId);
  if (!events) {
    events = [];
    invocationEvents.set(invocationId, events);
  }
  events.push(event);
}

function getEvents(invocationId: string): string[] {
  return invocationEvents.get(invocationId) ?? [];
}

function captureContext(): HooksProvider {
  return (ctx) => {
    capturedContexts.set(ctx.request.id, {
      id: ctx.request.id,
      target: {
        service: ctx.request.target.service,
        handler: ctx.request.target.handler,
        ...(ctx.request.target.key !== undefined
          ? { key: ctx.request.target.key }
          : {}),
      },
    });
    return {};
  };
}

function nextAttempt(invocationId: string): number {
  const n = (attemptCounts.get(invocationId) ?? 0) + 1;
  attemptCounts.set(invocationId, n);
  return n;
}

function errorTag(e: unknown, maxLen = 80): string {
  const msg = e instanceof Error ? e.message : String(e);
  const firstLine = msg.split("\n")[0]!;
  return firstLine.length > maxLen
    ? firstLine.slice(0, maxLen) + "..."
    : firstLine;
}

function recordHookEvents(tag = "hook"): HooksProvider {
  return (ctx) => {
    const id = ctx.request.id;
    return {
      interceptor: {
        handler: async (next) => {
          pushEvent(id, `${tag}:handler:before`);
          try {
            await next();
            pushEvent(id, `${tag}:handler:after`);
          } catch (e) {
            pushEvent(id, `${tag}:handler:error:${errorTag(e)}`);
            throw e;
          }
        },
        run: async (name, next) => {
          pushEvent(id, `${tag}:run:${name}:before`);
          try {
            await next();
            pushEvent(id, `${tag}:run:${name}:after`);
          } catch (e) {
            pushEvent(id, `${tag}:run:${name}:error:${errorTag(e)}`);
            throw e;
          }
        },
      },
    };
  };
}

function throwOnFirstHookProviderCall(targetService: string): HooksProvider {
  return (ctx) => {
    if (ctx.request.target.service === targetService) {
      if (nextAttempt(ctx.request.id) === 1)
        throw new Error("provider retryable error");
    }
    return {};
  };
}

function throwOnFirstHandlerIntercept(targetService: string): HooksProvider {
  return (ctx) => {
    if (ctx.request.target.service !== targetService) return {};
    return {
      interceptor: {
        handler: async (next) => {
          if (nextAttempt(ctx.request.id) === 1)
            throw new Error("interceptor retryable error");
          await next();
        },
      },
    };
  };
}

function throwOnFirstRunIntercept(targetService: string): HooksProvider {
  return (ctx) => {
    if (ctx.request.target.service !== targetService) return {};
    return {
      interceptor: {
        run: async (_name, next) => {
          if (nextAttempt(ctx.request.id) === 1)
            throw new Error("run interceptor retryable error");
          await next();
        },
      },
    };
  };
}

function throwTerminalOnHandlerIntercept(targetService: string): HooksProvider {
  return (ctx) => {
    if (ctx.request.target.service !== targetService) return {};
    return {
      interceptor: {
        handler: async (next) => {
          await next();
          throw new restate.TerminalError("interceptor terminal error", {
            metadata: {
              source: "handler-interceptor",
              severity: "critical",
            },
          });
        },
      },
    };
  };
}

function throwTerminalOnRunIntercept(targetService: string): HooksProvider {
  return (ctx) => {
    if (ctx.request.target.service !== targetService) return {};
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

function throwRetryableAfterHandlerNext(targetService: string): HooksProvider {
  return (ctx) => {
    if (ctx.request.target.service !== targetService) return {};
    return {
      interceptor: {
        handler: async (next) => {
          await next();
          if (nextAttempt(ctx.request.id) === 1)
            throw new Error("handler interceptor retryable after next");
        },
      },
    };
  };
}

function throwRetryableAfterRunNext(targetService: string): HooksProvider {
  return (ctx) => {
    if (ctx.request.target.service !== targetService) return {};
    return {
      interceptor: {
        run: async (_name, next) => {
          await next();
          if (nextAttempt(ctx.request.id) === 1)
            throw new Error("run interceptor retryable after next");
        },
      },
    };
  };
}

function swallowRunError(targetService: string): HooksProvider {
  return (ctx) => {
    if (ctx.request.target.service !== targetService) return {};
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

function wrapErrors(): HooksProvider {
  return () => ({
    interceptor: {
      handler: async (next) => {
        try {
          await next();
        } catch (e) {
          if (e instanceof restate.TerminalError) {
            throw new restate.TerminalError(`[hw] ${e.message}`, {
              errorCode: e.code,
              metadata: e.metadata,
            });
          }
          const err = e instanceof Error ? e : new Error(String(e));
          throw new Error(`[hw] ${err.message}`);
        }
      },
      run: async (_name, next) => {
        try {
          await next();
        } catch (e) {
          if (e instanceof restate.TerminalError) {
            throw new restate.TerminalError(`[rw] ${e.message}`, {
              errorCode: e.code,
              metadata: e.metadata,
            });
          }
          const err = e instanceof Error ? e : new Error(String(e));
          throw new Error(`[rw] ${err.message}`);
        }
      },
    },
  });
}

const fastRetry = { retryPolicy: { initialInterval: 10 } };

function storeAwakeableId(invocationId: string, awakeableId: string) {
  awakeableIds.set(invocationId, awakeableId);
}

function leaksFor(id: string) {
  if (!leakedMetadata.has(id))
    leakedMetadata.set(id, {
      commandType: [],
      commandIndex: [],
    });
  return leakedMetadata.get(id)!;
}

function recordLeak(id: string, source: string, e: unknown) {
  if (!(e instanceof Error)) return;
  const obj = e as unknown as Record<string, unknown>;
  if (obj.commandType !== undefined)
    leaksFor(id).commandType.push(`${source}: ${e.message}`);
  if (obj.commandIndex !== undefined)
    leaksFor(id).commandIndex.push(`${source}: ${e.message}`);
}

function findNewInvocation(knownIds: string[]) {
  const known = new Set(knownIds);
  for (const [invocationId, events] of invocationEvents) {
    if (!known.has(invocationId)) {
      return { invocationId, events };
    }
  }
  return null;
}

function resetHookState() {
  invocationEvents.clear();
  capturedContexts.clear();
  attemptCounts.clear();
  awakeableIds.clear();
  ksAttempts.clear();
  leakedMetadata.clear();
}

export const hooksTestDriver = restate.service({
  name: "HooksTestDriver",
  handlers: {
    getEvents: async (_ctx: restate.Context, invocationId: string) =>
      getEvents(invocationId),
    getInvocationIds: async () => Array.from(invocationEvents.keys()),
    findNewInvocation: async (_ctx: restate.Context, knownIds: string[]) =>
      findNewInvocation(knownIds),
    getCapturedContext: async (_ctx: restate.Context, invocationId: string) =>
      capturedContexts.get(invocationId) ?? null,
    getAwakeableId: async (_ctx: restate.Context, invocationId: string) =>
      awakeableIds.get(invocationId) ?? null,
    getLeaks: async (_ctx: restate.Context, invocationId: string) =>
      leakedMetadata.get(invocationId) ?? null,
    reset: async () => resetHookState(),
  },
});

function createHookLevelSuite(level: HookLevel) {
  // Insert wrapErrors() after the first hook (the recorder) so it wraps
  // all errors before they reach the outermost recording hook.
  const hooksAt = (hooks: HooksProvider[]) => {
    const [first, ...rest] = hooks;
    return withHooksAt(
      level,
      first != null ? [first, wrapErrors(), ...rest] : [wrapErrors()]
    );
  };

  // -- service definitions ------------------------------------------------

  const handlerOnlyService = createService({
    name: `${level}_HandlerOnly`,
    ...hooksAt([recordHookEvents()]),
    handler: (ctx, _) =>
      Promise.resolve({
        invocationId: ctx.request().id,
      }),
  });

  const handlerRunService = createService({
    name: `${level}_HandlerRun`,
    ...hooksAt([recordHookEvents()]),
    handler: async (ctx, _) => {
      await ctx.run("step", () => "done");
      return { invocationId: ctx.request().id };
    },
  });

  const retryService = createService({
    name: `${level}_Retry`,
    ...hooksAt([recordHookEvents()]),
    handler: (ctx, _) => {
      if (nextAttempt(ctx.request().id) === 1) throw new Error("retry");
      return Promise.resolve({ invocationId: ctx.request().id });
    },
    options: fastRetry,
  });

  const terminalService = createService({
    name: `${level}_Terminal`,
    ...hooksAt([recordHookEvents()]),
    handler: () => {
      throw new restate.TerminalError("terminal");
    },
  });

  const retryWithReplayedRunService = createService({
    name: `${level}_RetryRun`,
    ...hooksAt([recordHookEvents()]),
    handler: async (ctx, _) => {
      await ctx.run("step-1", () => "a");
      if (nextAttempt(ctx.request().id) === 1) throw new Error("retry");
      await ctx.run("step-2", () => "b");
      return { invocationId: ctx.request().id };
    },
    options: fastRetry,
  });

  const runRetryableService = createService({
    name: `${level}_RunRetry`,
    ...hooksAt([recordHookEvents()]),
    handler: async (ctx, _) => {
      const attempt = nextAttempt(ctx.request().id);
      await ctx.run("step", () => {
        if (attempt === 1) throw new Error("run retryable fail");
        return "done";
      });
      return { invocationId: ctx.request().id };
    },
    options: fastRetry,
  });

  const runTerminalService = createService({
    name: `${level}_RunTerminal`,
    ...hooksAt([recordHookEvents()]),
    handler: async (ctx, _) => {
      await ctx.run("step", () => {
        throw new restate.TerminalError("run fail", {
          metadata: { source: "run-closure", severity: "critical" },
        });
      });
      return { invocationId: ctx.request().id };
    },
  });

  const retryTwiceSuccessService = createService({
    name: `${level}_RetryTwiceSuccess`,
    ...hooksAt([recordHookEvents()]),
    handler: (ctx, _) => {
      if (nextAttempt(ctx.request().id) <= 2) throw new Error("retry");
      return Promise.resolve({ invocationId: ctx.request().id });
    },
    options: fastRetry,
  });

  const retryTwiceTerminalService = createService({
    name: `${level}_RetryTwiceTerminal`,
    ...hooksAt([recordHookEvents()]),
    handler: (ctx, _) => {
      const n = nextAttempt(ctx.request().id);
      if (n <= 2) throw new Error("retry");
      throw new restate.TerminalError("terminal after retries");
    },
    options: fastRetry,
  });

  const wait = (ms: number, signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      });
    });

  const concurrentRunService = createService({
    name: `${level}_ConcurrentRun`,
    ...hooksAt([recordHookEvents()]),
    handler: async (ctx, _) => {
      const attempt = nextAttempt(ctx.request().id);
      const signal = ctx.request().attemptCompletedSignal;
      await restate.RestatePromise.all([
        ctx.run("run-1", async () => {
          await wait(100, signal);
          if (attempt === 1) {
            await wait(100, signal);
            throw new Error("run-1 fail");
          }
          return "a";
        }),
        ctx.run("run-2", async () => {
          await wait(100, signal);
          if (attempt <= 2) {
            await wait(200, signal);
            throw new Error("run-2 fail");
          }
          return "b";
        }),
      ]);
      return { invocationId: ctx.request().id };
    },
    options: fastRetry,
  });

  const suspendService = createService({
    name: `${level}_Suspend`,
    ...hooksAt([recordHookEvents()]),
    handler: async (ctx, _) => {
      await ctx.run("before-suspend", () => "a");
      const { id, promise } = ctx.awakeable<string>();
      storeAwakeableId(ctx.request().id, id);
      await promise;
      await ctx.run("after-resume", () => "b");
      return { invocationId: ctx.request().id };
    },
    options: { inactivityTimeout: 500 },
  });

  const contextService = createService({
    name: `${level}_Context`,
    ...hooksAt([captureContext()]),
    handler: (ctx, _) =>
      Promise.resolve({
        invocationId: ctx.request().id,
      }),
  });

  const contextObjName = `${level}_ContextObj`;
  const contextObj = restate.object({
    name: contextObjName,
    handlers: {
      invoke: restate.createObjectHandler(
        {
          hooks: level === "handler" ? [captureContext()] : [],
        },
        (ctx: restate.ObjectContext, _input: string) =>
          Promise.resolve({
            invocationId: ctx.request().id,
          })
      ),
    },
    options: {
      ...(level === "service" ? { hooks: [captureContext()] } : {}),
    },
  });

  const providerErrorServiceName = `${level}_ProviderError`;
  const providerErrorService = createService({
    name: providerErrorServiceName,
    ...hooksAt([
      recordHookEvents(),
      throwOnFirstHookProviderCall(providerErrorServiceName),
    ]),
    handler: (ctx, _) => Promise.resolve({ invocationId: ctx.request().id }),
    options: fastRetry,
  });

  const interceptorErrorServiceName = `${level}_InterceptorError`;
  const interceptorErrorService = createService({
    name: interceptorErrorServiceName,
    ...hooksAt([
      recordHookEvents(),
      throwOnFirstHandlerIntercept(interceptorErrorServiceName),
    ]),
    handler: (ctx, _) => Promise.resolve({ invocationId: ctx.request().id }),
    options: fastRetry,
  });

  const runInterceptorErrorServiceName = `${level}_RunInterceptorError`;
  const runInterceptorErrorService = createService({
    name: runInterceptorErrorServiceName,
    ...hooksAt([
      recordHookEvents(),
      throwOnFirstRunIntercept(runInterceptorErrorServiceName),
    ]),
    handler: async (ctx, _) => {
      await ctx.run("step", () => "done");
      return { invocationId: ctx.request().id };
    },
    options: fastRetry,
  });

  const handlerInterceptTerminalServiceName = `${level}_HandlerInterceptTerminal`;
  const handlerInterceptTerminalService = createService({
    name: handlerInterceptTerminalServiceName,
    ...hooksAt([
      recordHookEvents(),
      throwTerminalOnHandlerIntercept(handlerInterceptTerminalServiceName),
    ]),
    handler: (ctx, _) => Promise.resolve({ invocationId: ctx.request().id }),
  });

  const runInterceptTerminalServiceName = `${level}_RunInterceptTerminal`;
  const runInterceptTerminalService = createService({
    name: runInterceptTerminalServiceName,
    ...hooksAt([
      recordHookEvents(),
      throwTerminalOnRunIntercept(runInterceptTerminalServiceName),
    ]),
    handler: async (ctx, _) => {
      await ctx.run("step", () => "done");
      return { invocationId: ctx.request().id };
    },
  });

  const handlerInterceptRetryableAfterNextName = `${level}_HandlerInterceptRetryableAfterNext`;
  const handlerInterceptRetryableAfterNextService = createService({
    name: handlerInterceptRetryableAfterNextName,
    ...hooksAt([
      recordHookEvents(),
      throwRetryableAfterHandlerNext(handlerInterceptRetryableAfterNextName),
    ]),
    handler: (ctx, _) => Promise.resolve({ invocationId: ctx.request().id }),
    options: fastRetry,
  });

  const runInterceptRetryableAfterNextName = `${level}_RunInterceptRetryableAfterNext`;
  const runInterceptRetryableAfterNextService = createService({
    name: runInterceptRetryableAfterNextName,
    ...hooksAt([
      recordHookEvents(),
      throwRetryableAfterRunNext(runInterceptRetryableAfterNextName),
    ]),
    handler: async (ctx, _) => {
      await ctx.run("step", () => "done");
      return { invocationId: ctx.request().id };
    },
    options: fastRetry,
  });

  const swallowRunErrorServiceName = `${level}_SwallowRunError`;
  const swallowRunErrorService = createService({
    name: swallowRunErrorServiceName,
    ...hooksAt([
      recordHookEvents(),
      swallowRunError(swallowRunErrorServiceName),
    ]),
    handler: async (ctx, _) => {
      await ctx.run("step", () => {
        throw new restate.TerminalError("run fail");
      });
      return { invocationId: ctx.request().id };
    },
  });

  const asyncContext = new AsyncLocalStorage<{ hookTag: string }>();
  const propagateAsyncContext: HooksProvider = () => ({
    interceptor: {
      handler: (next) => asyncContext.run({ hookTag: "from-hook" }, next),
    },
  });
  const asyncContextService = createService({
    name: `${level}_AsyncLocalStorage`,
    ...hooksAt([propagateAsyncContext]),
    handler: (ctx, _) => {
      const store = asyncContext.getStore();
      return Promise.resolve({
        invocationId: ctx.request().id,
        hookTag: store?.hookTag,
      });
    },
  });

  // -- edge case services --------------------------------------------------

  const nonExistentService = restate.service({
    name: "NonExistent",
    handlers: {
      call: async (_ctx: restate.Context, _input: string) =>
        Promise.resolve(""),
    },
  });
  const callNonExistentService = createService({
    name: `${level}_CallNonExistent`,
    ...hooksAt([recordHookEvents()]),
    handler: async (ctx, _) => {
      const client = ctx.serviceClient(nonExistentService);
      await client.call("");
      return { invocationId: ctx.request().id };
    },
    options: {
      retryPolicy: {
        initialInterval: 10,
        maxAttempts: 2,
        onMaxAttempts: "kill",
      },
    },
  });

  const failingSerde = {
    contentType: "application/json",
    serialize: (v: string) => new TextEncoder().encode(v),
    deserialize: () => {
      throw new Error("input serde failure");
    },
  };
  const inputSerdeFailService = createService({
    name: `${level}_InputSerdeFail`,
    ...hooksAt([recordHookEvents()]),
    handlerOpts: { input: failingSerde },
    handler: (ctx, _) => Promise.resolve({ invocationId: ctx.request().id }),
    options: {
      retryPolicy: {
        initialInterval: 10,
        maxAttempts: 3,
        onMaxAttempts: "kill",
      },
    },
  });

  const runSerdeFailService = createService({
    name: `${level}_RunSerdeFail`,
    ...hooksAt([recordHookEvents()]),
    handler: async (ctx, _) => {
      await ctx.run("step", () => "done", {
        serde: {
          contentType: "application/json",
          serialize: () => {
            throw new Error("run serde failure");
          },
          deserialize: (b: Uint8Array) => new TextDecoder().decode(b),
        },
      });
      return { invocationId: ctx.request().id };
    },
    options: {
      retryPolicy: {
        initialInterval: 10,
        maxAttempts: 2,
        onMaxAttempts: "kill",
      },
    },
  });

  const mapErrorService = createService({
    name: `${level}_MapError`,
    ...hooksAt([recordHookEvents()]),
    handler: async (ctx, _) => {
      const attempt = nextAttempt(ctx.request().id);
      const result = await ctx
        .run("step", () => "hello")
        .map((value) => {
          if (attempt === 1)
            throw new Error(`transient map error on: ${value}`);
          throw new restate.TerminalError(`map failed on: ${value}`);
        });
      return { invocationId: ctx.request().id, result };
    },
    options: {
      retryPolicy: {
        initialInterval: 10,
        maxAttempts: 3,
        onMaxAttempts: "kill",
      },
    },
  });

  const runMaxRetryService = createService({
    name: `${level}_RunMaxRetry`,
    ...hooksAt([recordHookEvents()]),
    handler: async (ctx, _) => {
      await ctx.run(
        "flaky-step",
        () => {
          throw new Error("always fails");
        },
        { maxRetryAttempts: 2, initialRetryInterval: 10 }
      );
      return { invocationId: ctx.request().id };
    },
  });

  class PaymentRejected extends Error {
    constructor() {
      super("Payment rejected");
    }
  }
  const asTerminalErrorService = createService({
    name: `${level}_AsTerminalError`,
    ...withHooksAt(level, [recordHookEvents()]),
    handler: async (ctx, _) => {
      await ctx.run("charge", () => {
        throw new PaymentRejected();
      });
      return { invocationId: ctx.request().id };
    },
    options: {
      asTerminalError: (e) => {
        if (e instanceof PaymentRejected)
          return new restate.TerminalError(e.message, { errorCode: 402 });
        return undefined;
      },
    },
  });

  const journalMismatchService = createService({
    name: `${level}_JournalMismatch`,
    ...hooksAt([recordHookEvents()]),
    handler: async (ctx, _) => {
      const attempt = nextAttempt(ctx.request().id);
      await ctx.run(attempt === 1 ? "step-a" : "step-b", () => {
        if (attempt === 1) throw new Error("transient");
        return "done";
      });
      return { invocationId: ctx.request().id };
    },
    options: {
      retryPolicy: {
        initialInterval: 10,
        maxAttempts: 3,
        onMaxAttempts: "kill",
      },
    },
  });

  const abortTimeoutService = createService({
    name: `${level}_AbortTimeout`,
    ...hooksAt([recordHookEvents()]),
    handler: async (ctx, _) => {
      const attempt = nextAttempt(ctx.request().id);
      await ctx.run("slow-step", async () => {
        if (attempt === 1) {
          // Properly listen to abort signal to cancel long-running work
          await new Promise<void>((resolve, reject) => {
            const signal = ctx.request().attemptCompletedSignal;
            signal.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              {
                once: true,
              }
            );
          });
        }
        return "done";
      });
      return { invocationId: ctx.request().id };
    },
    options: {
      inactivityTimeout: 100,
      abortTimeout: 100,
      retryPolicy: {
        initialInterval: 10,
        maxAttempts: 3,
        onMaxAttempts: "kill",
      },
    },
  });

  const cancelDuringRunService = createService({
    name: `${level}_CancelDuringRun`,
    ...hooksAt([recordHookEvents()]),
    handler: async (ctx, _) => {
      await ctx.run("slow-step", async () => {
        await new Promise<void>((_resolve, reject) => {
          const signal = ctx.request().attemptCompletedSignal;
          signal.addEventListener(
            "abort",
            () => reject(new restate.CancelledError()),
            { once: true }
          );
        });
        return "done";
      });
      return { invocationId: ctx.request().id };
    },
  });

  // Service where the run closure does NOT listen to attemptCompletedSignal.
  // When killed, the run interceptor must wait for the closure to complete
  // naturally (~1s) before its :after event fires.
  const cancelDuringSlowRunService = createService({
    name: `${level}_CancelDuringSlowRun`,
    ...hooksAt([recordHookEvents()]),
    handler: async (ctx, _) => {
      await ctx.run("slow-step", async () => {
        await wait(1_000);
        return "done";
      });
      return { invocationId: ctx.request().id };
    },
    options: { inactivityTimeout: 60_000 },
  });

  const pauseDuringRunService = createService({
    name: `${level}_PauseDuringRun`,
    ...hooksAt([recordHookEvents()]),
    handler: async (ctx, _) => {
      await ctx.run("slow-step", async () => {
        await wait(1_000);
        return "done";
      });
      await ctx.sleep(60_000);
      return { invocationId: ctx.request().id };
    },
  });

  const abortBeforeFirstCommandService = createService({
    name: `${level}_AbortBeforeFirstCommand`,
    ...hooksAt([recordHookEvents()]),
    handler: async (ctx, _) => {
      await wait(1_000);
      await ctx.run("after-wait", () => "done");
      return { invocationId: ctx.request().id };
    },
    options: {
      inactivityTimeout: 0,
      abortTimeout: 1,
      retryPolicy: {
        initialInterval: 10,
        maxAttempts: 1,
        onMaxAttempts: "kill",
      },
    },
  });

  const suspendPerEntryService = createService({
    name: `${level}_SuspendPerEntry`,
    ...hooksAt([recordHookEvents()]),
    handler: async (ctx, _) => {
      const attempt = nextAttempt(ctx.request().id);
      await ctx.run("step-1", () => {
        if (attempt === 1) throw new Error("step-1 transient");
        return "a";
      });
      await ctx.run("step-2", () => "b");
      return { invocationId: ctx.request().id };
    },
    options: {
      inactivityTimeout: 0,
      retryPolicy: { initialInterval: 10 },
    },
  });

  // -- awakeable services ---------------------------------------------------

  const awakeableSuccessService = createService({
    name: `${level}_AwakeableSuccess`,
    ...hooksAt([recordHookEvents()]),
    handler: async (ctx, _) => {
      const { id, promise } = ctx.awakeable();
      storeAwakeableId(ctx.request().id, id);
      const result = await promise;
      return { invocationId: ctx.request().id, result };
    },
  });

  const awakeableRejectService = createService({
    name: `${level}_AwakeableReject`,
    ...hooksAt([recordHookEvents()]),
    handler: async (ctx, _) => {
      const { id, promise } = ctx.awakeable();
      storeAwakeableId(ctx.request().id, id);
      await promise;
      return { invocationId: ctx.request().id };
    },
  });

  const failingDeserializeSerde = {
    serialize: (v: unknown) => new TextEncoder().encode(JSON.stringify(v)),
    deserialize: (): unknown => {
      throw new Error("awakeable serde fail");
    },
  };

  const awakeableSerdeFailService = createService({
    name: `${level}_AwakeableSerdeFailure`,
    ...hooksAt([recordHookEvents()]),
    handler: async (ctx, _) => {
      const attempt = nextAttempt(ctx.request().id);
      // Attempt 1: awakeable serde fails on deserialize → CommandError
      // Attempt 2+: normal awakeable succeeds
      const serde = attempt === 1 ? failingDeserializeSerde : undefined;
      const { id, promise } = ctx.awakeable(serde);
      storeAwakeableId(ctx.request().id, id);
      await promise;
      return { invocationId: ctx.request().id };
    },
    options: fastRetry,
  });

  const awakeableSerdeFailAfterRunService = createService({
    name: `${level}_AwakeableSerdeFailureAfterRun`,
    ...hooksAt([recordHookEvents()]),
    handler: async (ctx, _) => {
      const attempt = nextAttempt(ctx.request().id);
      await ctx.run("setup", () => "setup");
      const serde = attempt === 1 ? failingDeserializeSerde : undefined;
      const { id, promise } = ctx.awakeable(serde);
      storeAwakeableId(ctx.request().id, id);
      await promise;
      return { invocationId: ctx.request().id };
    },
    options: fastRetry,
  });

  return {
    handlerOnlyService,
    handlerRunService,
    retryService,
    terminalService,
    retryWithReplayedRunService,
    runRetryableService,
    runTerminalService,
    retryTwiceSuccessService,
    retryTwiceTerminalService,
    concurrentRunService,
    suspendService,
    contextService,
    contextObjName,
    contextObj,
    providerErrorService,
    interceptorErrorService,
    runInterceptorErrorService,
    handlerInterceptTerminalService,
    runInterceptTerminalService,
    handlerInterceptRetryableAfterNextService,
    runInterceptRetryableAfterNextService,
    swallowRunErrorService,
    asyncContextService,
    callNonExistentService,
    inputSerdeFailService,
    runSerdeFailService,
    mapErrorService,
    runMaxRetryService,
    asTerminalErrorService,
    journalMismatchService,
    abortTimeoutService,
    cancelDuringRunService,
    cancelDuringSlowRunService,
    pauseDuringRunService,
    abortBeforeFirstCommandService,
    suspendPerEntryService,
    awakeableSuccessService,
    awakeableRejectService,
    awakeableSerdeFailService,
    awakeableSerdeFailAfterRunService,
    services: [
      handlerOnlyService,
      handlerRunService,
      retryService,
      terminalService,
      retryWithReplayedRunService,
      runRetryableService,
      runTerminalService,
      callNonExistentService,
      retryTwiceSuccessService,
      retryTwiceTerminalService,
      concurrentRunService,
      suspendService,
      contextService,
      providerErrorService,
      interceptorErrorService,
      runInterceptorErrorService,
      handlerInterceptTerminalService,
      runInterceptTerminalService,
      handlerInterceptRetryableAfterNextService,
      runInterceptRetryableAfterNextService,
      swallowRunErrorService,
      asyncContextService,
      inputSerdeFailService,
      runSerdeFailService,
      mapErrorService,
      runMaxRetryService,
      asTerminalErrorService,
      journalMismatchService,
      abortTimeoutService,
      cancelDuringRunService,
      cancelDuringSlowRunService,
      pauseDuringRunService,
      abortBeforeFirstCommandService,
      awakeableSuccessService,
      awakeableRejectService,
      awakeableSerdeFailService,
      awakeableSerdeFailAfterRunService,
      suspendPerEntryService,
    ],
  };
}

export const hookSuites = {
  handler: createHookLevelSuite("handler"),
  service: createHookLevelSuite("service"),
};

export const overrideService = restate.service({
  name: "ServiceOverridesDefaultHooks",
  handlers: {
    invoke: (ctx: restate.Context, _input: string) =>
      Promise.resolve({ invocationId: ctx.request().id }),
  },
  options: {
    hooks: [recordHookEvents("service")],
  },
});

export const orderingService = restate.service({
  name: "Ordering",
  handlers: {
    invoke: restate.createServiceHandler(
      { hooks: [recordHookEvents("h1"), recordHookEvents("h2")] },
      async (ctx: restate.Context, _input: string) => {
        await ctx.run("step-1", () => "a");
        if (nextAttempt(ctx.request().id) === 1) throw new Error("retry");
        await ctx.run("step-2", () => "b");
        return { invocationId: ctx.request().id };
      }
    ),
  },
  options: {
    hooks: [recordHookEvents("s1"), recordHookEvents("s2")],
    retryPolicy: { initialInterval: 10 },
  },
});

const ksHook: HooksProvider = (ctx) => {
  const id = ctx.request.id;
  const attempt = (ksAttempts.get(id) ?? 0) + 1;
  ksAttempts.set(id, attempt);

  return {
    interceptor: {
      handler: async (next) => {
        if (attempt === 5) throw new Error("handler-interceptor boom");
        await next();
      },
      run: async (name, next) => {
        if (attempt === 3 && name === "step-3")
          throw new Error("run-interceptor boom");
        await next();
      },
    },
  };
};

const failingSerializeSerde = {
  contentType: "application/json",
  serialize: (): Uint8Array => {
    throw new Error("serde boom");
  },
  deserialize: (b: Uint8Array) => new TextDecoder().decode(b),
};

export const kitchenSinkService = createService({
  name: "KitchenSink_TransientErrors",
  serviceHooks: [ksHook],
  handler: async (ctx, _) => {
    const id = ctx.request().id;
    const attempt = ksAttempts.get(id) ?? 1;

    if (attempt === 1) throw new Error("handler boom");

    await ctx.run("step-1", () => {
      if (attempt === 2) throw new Error("step-1 boom");
      return "a";
    });

    await ctx.run("step-2", () => "b");
    await ctx.run("step-3", () => "c");

    await ctx.run(
      "step-4",
      () => "d",
      attempt === 4 ? { serde: failingSerializeSerde } : {}
    );

    const step5Name = attempt >= 7 ? "MISMATCH" : "step-5";
    await ctx.run(step5Name, () => "e");

    if (attempt === 6) throw new Error("pre-mismatch");

    return { invocationId: ctx.request().id };
  },
  options: {
    retryPolicy: {
      initialInterval: 10,
      maxAttempts: 9,
      onMaxAttempts: "kill",
    },
  },
});

const recordLeakedMetadata: HooksProvider = (ctx) => {
  const id = ctx.request.id;
  return {
    interceptor: {
      handler: async (next) => {
        try {
          await next();
        } catch (e) {
          recordLeak(id, "handler", e);
          throw e;
        }
      },
      run: async (_name, next) => {
        try {
          await next();
        } catch (e) {
          recordLeak(id, "run", e);
          throw e;
        }
      },
    },
  };
};

export const metadataLeakService = createService({
  name: "ErrorIsolation_MetadataLeak",
  serviceHooks: [recordLeakedMetadata],
  handler: async (ctx, _) => {
    const attempt = nextAttempt(ctx.request().id);
    await ctx.sleep(attempt === 1 ? NaN : 10);
    return { invocationId: ctx.request().id };
  },
  options: fastRetry,
});

const overrideRetryAfterHook: HooksProvider = () => ({
  interceptor: {
    handler: async (next) => {
      try {
        await next();
      } catch {
        throw new restate.RetryableError("handler-wrapped", {
          retryAfter: 10,
        });
      }
    },
    run: async (_name, next) => {
      try {
        await next();
      } catch {
        throw new restate.RetryableError("run-wrapped", {
          retryAfter: 10,
        });
      }
    },
  },
});

export const withCustomRetryAfterService = createService({
  name: "ErrorIsolation_CustomRetryAfter",
  serviceHooks: [overrideRetryAfterHook],
  handler: async (ctx, _) => {
    const attempt = nextAttempt(ctx.request().id);
    await ctx.run("step", () => {
      if (attempt === 1) throw new Error("run failed");
      return "done";
    });
    if (attempt === 2) throw new Error("handler failed");
    return { invocationId: ctx.request().id };
  },
  options: {
    retryPolicy: {
      initialInterval: 120_000,
    },
  },
});

for (const suite of Object.values(hookSuites)) {
  for (const service of suite.services) {
    REGISTRY.addService(service);
  }
  REGISTRY.addObject(suite.contextObj);
}

REGISTRY.addService(hooksTestDriver);
REGISTRY.addService(overrideService);
REGISTRY.addService(orderingService);
REGISTRY.addService(kitchenSinkService);
REGISTRY.addService(metadataLeakService);
REGISTRY.addService(withCustomRetryAfterService);

export type HooksTestDriver = typeof hooksTestDriver;
export type HookLevelSuite = (typeof hookSuites)[HookLevel];
export type OverrideService = typeof overrideService;
export type OrderingService = typeof orderingService;
export type KitchenSinkService = typeof kitchenSinkService;
export type MetadataLeakService = typeof metadataLeakService;
export type WithCustomRetryAfterService = typeof withCustomRetryAfterService;
