import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { AsyncLocalStorage } from "node:async_hooks";
import * as restate from "@restatedev/restate-sdk";
import * as clients from "@restatedev/restate-sdk-clients";
import { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import type {
  HooksProvider,
  AttemptResult,
  HookContext,
} from "@restatedev/restate-sdk";

// ---------------------------------------------------------------------------
// Per-invocation event capture — keyed by invocationId, safe under parallel
// ---------------------------------------------------------------------------

const invocationEvents = new Map<string, string[]>();

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

function getResults(invocationId: string): AttemptResult[] {
  return capturedResults.get(invocationId) ?? [];
}

// ---------------------------------------------------------------------------
// Per-invocation context capture
// ---------------------------------------------------------------------------

const capturedContexts = new Map<string, HookContext>();

function contextCapturingHook(): HooksProvider {
  return (ctx: HookContext) => {
    capturedContexts.set(ctx.invocationId, ctx);
    return {};
  };
}

// ---------------------------------------------------------------------------
// Attempt tracking — used by retry test handlers
// ---------------------------------------------------------------------------

const attemptCounts = new Map<string, number>();

function nextAttempt(invocationId: string): number {
  const n = (attemptCounts.get(invocationId) ?? 0) + 1;
  attemptCounts.set(invocationId, n);
  return n;
}

// ---------------------------------------------------------------------------
// Hook factories
// ---------------------------------------------------------------------------

function recordingHook(tag: string): HooksProvider {
  return (ctx: HookContext) => {
    const id = ctx.invocationId;
    return {
      interceptor: {
        handler: async (next) => {
          pushEvent(id, `${tag}:handler:before`);
          await next();
          pushEvent(id, `${tag}:handler:after`);
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
function providerErrorHook(targetService: string): HooksProvider {
  return (ctx: HookContext) => {
    if (ctx.serviceName === targetService) {
      if (nextAttempt(ctx.invocationId) === 1)
        throw new Error("provider retryable error");
    }
    return {};
  };
}

/** Hook whose handler interceptor throws a retryable error on the first attempt */
function interceptorErrorHook(targetService: string): HooksProvider {
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
function runInterceptorErrorHook(targetService: string): HooksProvider {
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

/** Hook whose handler interceptor never calls next — handler body never executes */
function skipNextHook(targetService: string): HooksProvider {
  return (ctx: HookContext) => {
    if (ctx.serviceName !== targetService) return {};
    return {
      interceptor: {
        handler: (_next) => Promise.resolve(),
      },
    };
  };
}

/** Listener that always throws for the target service — errors should be swallowed by the SDK */
function listenerErrorHook(targetService: string): HooksProvider {
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

async function invokeExpectingError(
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

const fastRetry = { retryPolicy: { initialInterval: 10 } };

// ---------------------------------------------------------------------------
// Test factory — runs the same suite at handler / service / endpoint level
// ---------------------------------------------------------------------------

type HookLevel = "handler" | "service" | "endpoint";

function hooksSuite(level: HookLevel) {
  describe(`${level}-level hooks`, { timeout: 120_000 }, () => {
    const tag = "hook";

    // -- helper: register hooks at the right level --------------------------

    function createService(
      name: string,
      hooks: HooksProvider[],
      handler: (ctx: restate.Context, input: string) => Promise<unknown>,
      options?: {
        retryPolicy?: { initialInterval?: number };
        inactivityTimeout?: number;
      }
    ) {
      const fullName = `${level}_${name}`;
      const serviceOpts: Record<string, unknown> = { ...options };
      if (level === "service") serviceOpts.hooks = hooks;

      switch (level) {
        case "handler":
          return restate.service({
            name: fullName,
            handlers: {
              invoke: restate.createServiceHandler({ hooks: hooks }, handler),
            },
            ...(Object.keys(serviceOpts).length
              ? { options: serviceOpts }
              : {}),
          });
        case "service":
          return restate.service({
            name: fullName,
            handlers: { invoke: handler },
            options: serviceOpts,
          });
        case "endpoint":
          return restate.service({
            name: fullName,
            handlers: { invoke: handler },
            ...(Object.keys(serviceOpts).length
              ? { options: serviceOpts }
              : {}),
          });
      }
    }

    // -- service definitions ------------------------------------------------

    const handlerOnlySvc = createService(
      "HandlerOnly",
      [recordingHook(tag)],
      (ctx, _) =>
        Promise.resolve({
          invocationId: ctx.request().id,
        })
    );

    const handlerRunSvc = createService(
      "HandlerRun",
      [recordingHook(tag)],
      async (ctx, _) => {
        await ctx.run("step", () => "done");
        return { invocationId: ctx.request().id };
      }
    );

    const retrySvc = createService(
      "Retry",
      [recordingHook(tag)],
      (ctx, _) => {
        if (nextAttempt(ctx.request().id) === 1) throw new Error("retry");
        return Promise.resolve({ invocationId: ctx.request().id });
      },
      fastRetry
    );

    const terminalSvc = createService("Terminal", [recordingHook(tag)], () => {
      throw new restate.TerminalError("terminal");
    });

    const retryWithReplayedRunSvc = createService(
      "RetryRun",
      [recordingHook(tag)],
      async (ctx, _) => {
        await ctx.run("step-1", () => "a");
        if (nextAttempt(ctx.request().id) === 1) throw new Error("retry");
        await ctx.run("step-2", () => "b");
        return { invocationId: ctx.request().id };
      },
      fastRetry
    );

    const runRetryableSvc = createService(
      "RunRetry",
      [recordingHook(tag)],
      async (ctx, _) => {
        const attempt = nextAttempt(ctx.request().id);
        await ctx.run("step", () => {
          if (attempt === 1) throw new Error("run retryable fail");
          return "done";
        });
        return { invocationId: ctx.request().id };
      },
      fastRetry
    );

    const runTerminalSvc = createService(
      "RunTerminal",
      [recordingHook(tag)],
      async (ctx, _) => {
        await ctx.run("step", () => {
          throw new restate.TerminalError("run fail");
        });
        return { invocationId: ctx.request().id };
      }
    );

    const retryTwiceSuccessSvc = createService(
      "RetryTwiceSuccess",
      [recordingHook(tag)],
      (ctx, _) => {
        if (nextAttempt(ctx.request().id) <= 2) throw new Error("retry");
        return Promise.resolve({ invocationId: ctx.request().id });
      },
      fastRetry
    );

    const retryTwiceTerminalSvc = createService(
      "RetryTwiceTerminal",
      [recordingHook(tag)],
      (ctx, _) => {
        const n = nextAttempt(ctx.request().id);
        if (n <= 2) throw new Error("retry");
        throw new restate.TerminalError("terminal after retries");
      },
      fastRetry
    );

    const wait = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));

    const concurrentRunSvc = createService(
      "ConcurrentRun",
      [recordingHook(tag)],
      async (ctx, _) => {
        const attempt = nextAttempt(ctx.request().id);
        await restate.RestatePromise.all([
          ctx.run("run-1", async () => {
            await wait(100);
            if (attempt === 1) {
              await wait(100);
              throw new Error("run-1 fail");
            }
            return "a";
          }),
          ctx.run("run-2", async () => {
            await wait(100);
            if (attempt <= 2) {
              await wait(200);
              throw new Error("run-2 fail");
            }
            return "b";
          }),
        ]);
        return { invocationId: ctx.request().id };
      },
      fastRetry
    );

    const suspendSvc = createService(
      "Suspend",
      [recordingHook(tag)],
      async (ctx, _) => {
        await ctx.run("before-sleep", () => "a");
        await ctx.sleep(1000);
        await ctx.run("after-sleep", () => "b");
        return { invocationId: ctx.request().id };
      },
      { inactivityTimeout: 100 }
    );

    const contextSvc = createService(
      "Context",
      [contextCapturingHook()],
      (ctx, _) =>
        Promise.resolve({
          invocationId: ctx.request().id,
        })
    );

    const contextObjName = `${level}_ContextObj`;
    const contextObj = restate.object({
      name: contextObjName,
      handlers: {
        invoke: restate.createObjectHandler(
          {
            hooks: level === "handler" ? [contextCapturingHook()] : [],
          },
          (ctx: restate.ObjectContext, _input: string) =>
            Promise.resolve({
              invocationId: ctx.request().id,
            })
        ),
      },
      options: {
        ...(level === "service" ? { hooks: [contextCapturingHook()] } : {}),
      },
    });

    const providerErrorSvcName = `${level}_ProviderError`;
    const providerErrorSvc = createService(
      "ProviderError",
      [recordingHook(tag), providerErrorHook(providerErrorSvcName)],
      (ctx, _) => Promise.resolve({ invocationId: ctx.request().id }),
      fastRetry
    );

    const interceptorErrorSvcName = `${level}_InterceptorError`;
    const interceptorErrorSvc = createService(
      "InterceptorError",
      [recordingHook(tag), interceptorErrorHook(interceptorErrorSvcName)],
      (ctx, _) => Promise.resolve({ invocationId: ctx.request().id }),
      fastRetry
    );

    const runInterceptorErrorSvcName = `${level}_RunInterceptorError`;
    const runInterceptorErrorSvc = createService(
      "RunInterceptorError",
      [recordingHook(tag), runInterceptorErrorHook(runInterceptorErrorSvcName)],
      async (ctx, _) => {
        await ctx.run("step", () => "done");
        return { invocationId: ctx.request().id };
      },
      fastRetry
    );

    const listenerErrorSvcName = `${level}_ListenerError`;
    const listenerErrorSvc = createService(
      "ListenerError",
      [recordingHook(tag), listenerErrorHook(listenerErrorSvcName)],
      (ctx, _) => Promise.resolve({ invocationId: ctx.request().id })
    );

    const skipNextSvcName = `${level}_SkipNext`;
    const skipNextSvc = createService(
      "SkipNext",
      [recordingHook(tag), skipNextHook(skipNextSvcName)],
      (ctx, _) => Promise.resolve({ invocationId: ctx.request().id })
    );

    const als = new AsyncLocalStorage<{ hookTag: string }>();
    const alsHook: HooksProvider = () => ({
      interceptor: {
        handler: (next) => als.run({ hookTag: "from-hook" }, next),
      },
    });
    const alsSvc = createService(
      "AsyncLocalStorage",
      [alsHook],
      (ctx, _) => {
        const store = als.getStore();
        return Promise.resolve({
          invocationId: ctx.request().id,
          hookTag: store?.hookTag,
        });
      }
    );

    // -- environment --------------------------------------------------------

    let env: RestateTestEnvironment;

    beforeAll(async () => {
      const services = [
        handlerOnlySvc,
        handlerRunSvc,
        retrySvc,
        terminalSvc,
        retryWithReplayedRunSvc,
        runRetryableSvc,
        runTerminalSvc,
        retryTwiceSuccessSvc,
        retryTwiceTerminalSvc,
        concurrentRunSvc,
        suspendSvc,
        contextSvc,
        contextObj,
        providerErrorSvc,
        interceptorErrorSvc,
        runInterceptorErrorSvc,
        listenerErrorSvc,
        skipNextSvc,
        alsSvc,
      ];
      env = await RestateTestEnvironment.start({
        services,
        ...(level === "endpoint"
          ? {
              hooks: [
                recordingHook(tag),
                contextCapturingHook(),
                providerErrorHook(providerErrorSvcName),
                interceptorErrorHook(interceptorErrorSvcName),
                runInterceptorErrorHook(runInterceptorErrorSvcName),
                listenerErrorHook(listenerErrorSvcName),
                skipNextHook(skipNextSvcName),
                alsHook,
              ],
            }
          : {}),
      });
    });

    afterAll(async () => {
      await env?.stop();
    });

    // -- test helpers -------------------------------------------------------

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type AnySvc = restate.ServiceDefinition<string, any>;

    async function invoke(svc: AnySvc) {
      const client = clients.connect({ url: env.baseUrl() }).serviceClient(svc);
      const { invocationId } = (await client.invoke!("")) as {
        invocationId: string;
      };
      return { invocationId, events: getEvents(invocationId) };
    }

    async function invokeAndExpectError(svc: AnySvc) {
      const client = clients.connect({ url: env.baseUrl() }).serviceClient(svc);
      return invokeExpectingError(() =>
        client.invoke!("") as Promise<unknown>
      );
    }

    // -- tests --------------------------------------------------------------

    it("handler interceptor only", async () => {
      const { events } = await invoke(handlerOnlySvc);
      expect(events).toEqual([
        "hook:handler:before",
        "hook:handler:after",
        "hook:attemptEnd:success",
      ]);
    });

    it("handler + run interceptor", async () => {
      const { events } = await invoke(handlerRunSvc);
      expect(events).toEqual([
        "hook:handler:before",
        "hook:run:step:before",
        "hook:run:step:after",
        "hook:handler:after",
        "hook:attemptEnd:success",
      ]);
    });

    it("handler with retry — no duplicate events", async () => {
      const { events } = await invoke(retrySvc);
      expect(events).toEqual([
        // attempt 1: retryable error
        "hook:handler:before",
        "hook:attemptEnd:retryableError",
        // attempt 2: success
        "hook:handler:before",
        "hook:handler:after",
        "hook:attemptEnd:success",
      ]);
    });

    it("terminal error", async () => {
      const { events } = await invokeAndExpectError(terminalSvc);
      expect(events).toEqual([
        "hook:handler:before",
        "hook:attemptEnd:terminalError",
      ]);
    });

    it("attemptEnd receives the actual error for retryable errors", async () => {
      const { invocationId } = await invoke(retrySvc);
      const results = getResults(invocationId);

      expect(results).toHaveLength(2);
      expect(results[0]!.type).toBe("retryableError");
      expect(
        (results[0] as { type: "retryableError"; error: Error }).error.message
      ).toBe("retry");
      expect(results[1]!.type).toBe("success");
    });

    it("attemptEnd receives the actual error for terminal errors", async () => {
      const { invocationId } = await invokeAndExpectError(terminalSvc);
      const results = getResults(invocationId!);

      expect(results).toHaveLength(1);
      expect(results[0]!.type).toBe("terminalError");
      expect(
        (results[0] as { type: "terminalError"; error: Error }).error.message
      ).toBe("terminal");
    });

    it("handler + run with retry — replayed run skips interceptor", async () => {
      const { events } = await invoke(retryWithReplayedRunSvc);
      expect(events).toEqual([
        // attempt 1: step-1 executes, then retryable error
        "hook:handler:before",
        "hook:run:step-1:before",
        "hook:run:step-1:after",
        "hook:attemptEnd:retryableError",
        // attempt 2: step-1 replayed (no interceptor), step-2 executes
        "hook:handler:before",
        "hook:run:step-2:before",
        "hook:run:step-2:after",
        "hook:handler:after",
        "hook:attemptEnd:success",
      ]);
    });

    it("run throws retryable error then succeeds", async () => {
      const { events } = await invoke(runRetryableSvc);
      expect(events).toEqual([
        // attempt 1: run closure throws retryable error — handled internally,
        // no attemptEnd (the run failure is retried by the runtime)
        "hook:handler:before",
        "hook:run:step:before",
        "hook:run:step:error",
        // attempt 2: run closure succeeds
        "hook:handler:before",
        "hook:run:step:before",
        "hook:run:step:after",
        "hook:handler:after",
        "hook:attemptEnd:success",
      ]);
    });

    it("run throws terminal error", async () => {
      const { events } = await invokeAndExpectError(runTerminalSvc);
      expect(events).toEqual([
        "hook:handler:before",
        "hook:run:step:before",
        "hook:run:step:error",
        "hook:attemptEnd:terminalError",
      ]);
    });

    it("hook provider error triggers retry then succeeds", async () => {
      const { events } = await invoke(providerErrorSvc);
      expect(events).toEqual([
        // attempt 1: recording hook instantiated, then provider throws
        // — handler interceptor never started, only attemptEnd fires
        "hook:attemptEnd:retryableError",
        // attempt 2: all providers succeed, handler runs normally
        "hook:handler:before",
        "hook:handler:after",
        "hook:attemptEnd:success",
      ]);
    });

    it("interceptor error triggers retry then succeeds", async () => {
      const { events } = await invoke(interceptorErrorSvc);
      expect(events).toEqual([
        // attempt 1: recording hook's handler:before fires (outermost),
        // then error hook's interceptor throws — handler:after skipped
        "hook:handler:before",
        "hook:attemptEnd:retryableError",
        // attempt 2: error hook's interceptor succeeds
        "hook:handler:before",
        "hook:handler:after",
        "hook:attemptEnd:success",
      ]);
    });

    it("run interceptor error triggers retry then succeeds", async () => {
      const { events } = await invoke(runInterceptorErrorSvc);
      expect(events).toEqual([
        // attempt 1: handler starts, run interceptor throws — handled internally,
        // no attemptEnd (the run failure is retried by the runtime)
        "hook:handler:before",
        "hook:run:step:before",
        "hook:run:step:error",
        // attempt 2: run interceptor succeeds, run executes
        "hook:handler:before",
        "hook:run:step:before",
        "hook:run:step:after",
        "hook:handler:after",
        "hook:attemptEnd:success",
      ]);
    });

    it("listener error is swallowed — does not affect execution", async () => {
      const { events } = await invoke(listenerErrorSvc);
      // Handler succeeds despite listener throwing
      expect(events).toEqual([
        "hook:handler:before",
        "hook:handler:after",
        "hook:attemptEnd:success",
      ]);
    });

    it.skip("handler interceptor not calling next — handler body never executes", async () => {
      const { events } = await invokeAndExpectError(skipNextSvc);
      // The recording hook (outermost) calls next(), which enters the
      // skip-next hook that returns without calling next(). The handler
      // body never runs, no output is written — the SDK treats this as
      // a successful interceptor return with no response, which is a
      // protocol error (no output was written).
      expect(events).toEqual([
        "hook:handler:before",
        "hook:handler:after",
        "hook:attemptEnd:terminalError",
      ]);
    });

    it("attemptEnd with multiple retries then success", async () => {
      const { events } = await invoke(retryTwiceSuccessSvc);
      expect(events).toEqual([
        "hook:handler:before",
        "hook:attemptEnd:retryableError",
        "hook:handler:before",
        "hook:attemptEnd:retryableError",
        "hook:handler:before",
        "hook:handler:after",
        "hook:attemptEnd:success",
      ]);
    });

    it("attemptEnd with multiple retries then terminal error", async () => {
      const { events } = await invokeAndExpectError(retryTwiceTerminalSvc);
      expect(events).toEqual([
        "hook:handler:before",
        "hook:attemptEnd:retryableError",
        "hook:handler:before",
        "hook:attemptEnd:retryableError",
        "hook:handler:before",
        "hook:attemptEnd:terminalError",
      ]);
    });

    it("concurrent runs with progressive retries", async () => {
      const { events } = await invoke(concurrentRunSvc);
      const anyRunBefore = expect.stringMatching(
        /^hook:run:run-[12]:before$/
      ) as unknown as string;
      expect(events).toEqual([
        // attempt 1: both runs start (order non-deterministic), run-1 fails at 200ms
        "hook:handler:before",
        anyRunBefore,
        anyRunBefore,
        "hook:run:run-1:error",
        // attempt 2: both start, run-1 succeeds at 100ms, run-2 fails at 300ms
        // (run-2:error from attempt 1 also arrives)
        "hook:handler:before",
        anyRunBefore,
        anyRunBefore,
        "hook:run:run-2:error",
        "hook:run:run-1:after",
        "hook:run:run-2:error",
        // attempt 3: run-1 replayed, run-2 succeeds (instant)
        "hook:handler:before",
        "hook:run:run-2:before",
        "hook:run:run-2:after",
        "hook:handler:after",
        "hook:attemptEnd:success",
      ]);
    });

    it("handler with suspension resumes and completes", async () => {
      const { events } = await invoke(suspendSvc);
      expect(events).toEqual([
        // attempt 1: runs before-sleep, then suspends (inactivityTimeout: 100ms)
        // — no attemptEnd (suspension is not an error or success)
        "hook:handler:before",
        "hook:run:before-sleep:before",
        "hook:run:before-sleep:after",
        // attempt 2: replays before-sleep + sleep, then executes after-sleep
        "hook:handler:before",
        "hook:run:after-sleep:before",
        "hook:run:after-sleep:after",
        "hook:handler:after",
        "hook:attemptEnd:success",
      ]);
    });

    it("handler interceptor propagates async context to handler", async () => {
      const client = clients.connect({ url: env.baseUrl() }).serviceClient(alsSvc);
      const { hookTag } = (await client.invoke("")) as {
        hookTag: string;
      };
      expect(hookTag).toBe("from-hook");
    });

    it("hooks provider receives correct HookContext for service", async () => {
      const { invocationId } = await invoke(contextSvc);
      const ctx = capturedContexts.get(invocationId);
      expect(ctx).toBeDefined();
      expect(ctx!.serviceName).toBe(`${level}_Context`);
      expect(ctx!.handlerName).toBe("invoke");
      expect(ctx!.key).toBeUndefined();
      expect(ctx!.invocationId).toBe(invocationId);
      expect(ctx!.request).toBeDefined();
      expect(ctx!.request.headers).toBeDefined();
      expect(ctx!.request.attemptHeaders).toBeDefined();
    });

    it("hooks provider receives correct HookContext with key for virtual object", async () => {
      const ingress = clients.connect({ url: env.baseUrl() });
      const client = ingress.objectClient(contextObj, "my-key");
      const { invocationId } = (await client.invoke("")) as {
        invocationId: string;
      };

      const ctx = capturedContexts.get(invocationId);
      expect(ctx).toBeDefined();
      expect(ctx!.serviceName).toBe(contextObjName);
      expect(ctx!.handlerName).toBe("invoke");
      expect(ctx!.key).toBe("my-key");
      expect(ctx!.invocationId).toBe(invocationId);
      expect(ctx!.request).toBeDefined();
      expect(ctx!.request.headers).toBeDefined();
      expect(ctx!.request.attemptHeaders).toBeDefined();
    });
  });
}

// ---------------------------------------------------------------------------
// Generate suites for each level
// ---------------------------------------------------------------------------

hooksSuite("handler");
hooksSuite("service");
hooksSuite("endpoint");

// ---------------------------------------------------------------------------
// Composition ordering: 2 hooks per level, with retries
// ---------------------------------------------------------------------------

describe("hooks composition ordering", { timeout: 120_000 }, () => {
  let env: RestateTestEnvironment;

  const orderingSvc = restate.service({
    name: "Ordering",
    handlers: {
      invoke: restate.createServiceHandler(
        { hooks: [recordingHook("h1"), recordingHook("h2")] },
        async (ctx: restate.Context, _input: string) => {
          await ctx.run("step-1", () => "a");
          if (nextAttempt(ctx.request().id) === 1) throw new Error("retry");
          await ctx.run("step-2", () => "b");
          return { invocationId: ctx.request().id };
        }
      ),
    },
    options: {
      hooks: [recordingHook("s1"), recordingHook("s2")],
      retryPolicy: { initialInterval: 10 },
    },
  });

  beforeAll(async () => {
    env = await RestateTestEnvironment.start({
      services: [orderingSvc],
      hooks: [recordingHook("e1"), recordingHook("e2")],
    });
  });

  afterAll(async () => {
    await env?.stop();
  });

  it("endpoint -> service -> handler nesting with retries", async () => {
    const client = clients
      .connect({ url: env.baseUrl() })
      .serviceClient(orderingSvc);
    const { invocationId } = (await client.invoke("")) as {
      invocationId: string;
    };

    expect(getEvents(invocationId)).toEqual([
      // ---- attempt 1: step-1 succeeds, then retryable error ----
      // handler interceptors nest outermost-first
      "e1:handler:before",
      "e2:handler:before",
      "s1:handler:before",
      "s2:handler:before",
      "h1:handler:before",
      "h2:handler:before",
      // run interceptors for step-1
      "e1:run:step-1:before",
      "e2:run:step-1:before",
      "s1:run:step-1:before",
      "s2:run:step-1:before",
      "h1:run:step-1:before",
      "h2:run:step-1:before",
      // run:after unwinds innermost-first
      "h2:run:step-1:after",
      "h1:run:step-1:after",
      "s2:run:step-1:after",
      "s1:run:step-1:after",
      "e2:run:step-1:after",
      "e1:run:step-1:after",
      // error propagates — handler:after not fired
      // listeners fire in registration order
      "e1:attemptEnd:retryableError",
      "e2:attemptEnd:retryableError",
      "s1:attemptEnd:retryableError",
      "s2:attemptEnd:retryableError",
      "h1:attemptEnd:retryableError",
      "h2:attemptEnd:retryableError",

      // ---- attempt 2: step-1 replayed, step-2 executes, success ----
      "e1:handler:before",
      "e2:handler:before",
      "s1:handler:before",
      "s2:handler:before",
      "h1:handler:before",
      "h2:handler:before",
      // step-1 replayed — no run interceptor events
      // run interceptors for step-2
      "e1:run:step-2:before",
      "e2:run:step-2:before",
      "s1:run:step-2:before",
      "s2:run:step-2:before",
      "h1:run:step-2:before",
      "h2:run:step-2:before",
      "h2:run:step-2:after",
      "h1:run:step-2:after",
      "s2:run:step-2:after",
      "s1:run:step-2:after",
      "e2:run:step-2:after",
      "e1:run:step-2:after",
      // handler:after unwinds innermost-first
      "h2:handler:after",
      "h1:handler:after",
      "s2:handler:after",
      "s1:handler:after",
      "e2:handler:after",
      "e1:handler:after",
      // listeners
      "e1:attemptEnd:success",
      "e2:attemptEnd:success",
      "s1:attemptEnd:success",
      "s2:attemptEnd:success",
      "h1:attemptEnd:success",
      "h2:attemptEnd:success",
    ]);
  });
});
