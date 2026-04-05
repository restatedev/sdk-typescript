import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { AsyncLocalStorage } from "node:async_hooks";
import * as restate from "@restatedev/restate-sdk";
import * as clients from "@restatedev/restate-sdk-clients";
import { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import type { HooksProvider } from "@restatedev/restate-sdk";
import {
  type HookLevel,
  createService,
  withHooksAt,
  getEvents,
  getResults,
  getCapturedContext,
  captureContext,
  nextAttempt,
  recordHookEvents,
  throwOnFirstHookProviderCall,
  throwOnFirstHandlerIntercept,
  throwOnFirstRunIntercept,
  throwTerminalOnHandlerIntercept,
  throwTerminalOnRunIntercept,
  swallowRunError,
  throwOnAttemptEnd,
  invokeExpectingError,
  fastRetry,
} from "./test-utils.js";

function hooksSuite(level: HookLevel) {
  describe(`${level}-level hooks`, { timeout: 120_000 }, () => {
    const hooksAt = (hooks: HooksProvider[]) => withHooksAt(level, hooks);

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
          throw new restate.TerminalError("run fail");
        });
        return { invocationId: ctx.request().id };
      },
    });

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

    const wait = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));

    const concurrentRunService = createService({
      name: `${level}_ConcurrentRun`,
      ...hooksAt([recordHookEvents()]),
      handler: async (ctx, _) => {
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
      options: fastRetry,
    });

    const suspendService = createService({
      name: `${level}_Suspend`,
      ...hooksAt([recordHookEvents()]),
      handler: async (ctx, _) => {
        await ctx.run("before-sleep", () => "a");
        await ctx.sleep(1000);
        await ctx.run("after-sleep", () => "b");
        return { invocationId: ctx.request().id };
      },
      options: { inactivityTimeout: 100 },
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
      ...hooksAt([recordHookEvents(), throwOnFirstHookProviderCall(providerErrorServiceName)]),
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

    const swallowRunErrorServiceName = `${level}_SwallowRunError`;
    const swallowRunErrorService = createService({
      name: swallowRunErrorServiceName,
      ...hooksAt([recordHookEvents(), swallowRunError(swallowRunErrorServiceName)]),
      handler: async (ctx, _) => {
        await ctx.run("step", () => {
          throw new restate.TerminalError("run fail");
        });
        return { invocationId: ctx.request().id };
      },
    });

    const listenerErrorServiceName = `${level}_ListenerError`;
    const listenerErrorService = createService({
      name: listenerErrorServiceName,
      ...hooksAt([recordHookEvents(), throwOnAttemptEnd(listenerErrorServiceName)]),
      handler: (ctx, _) => Promise.resolve({ invocationId: ctx.request().id }),
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

    // -- environment --------------------------------------------------------

    let env: RestateTestEnvironment;

    beforeAll(async () => {
      const services = [
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
        contextObj,
        providerErrorService,
        interceptorErrorService,
        runInterceptorErrorService,
        handlerInterceptTerminalService,
        runInterceptTerminalService,
        swallowRunErrorService,
        listenerErrorService,
        asyncContextService,
      ];
      env = await RestateTestEnvironment.start({
        services,
        ...(level === "endpoint"
          ? {
              hooks: [
                recordHookEvents(),
                captureContext(),
                throwOnFirstHookProviderCall(providerErrorServiceName),
                throwOnFirstHandlerIntercept(interceptorErrorServiceName),
                throwOnFirstRunIntercept(runInterceptorErrorServiceName),
                throwTerminalOnHandlerIntercept(handlerInterceptTerminalServiceName),
                throwTerminalOnRunIntercept(runInterceptTerminalServiceName),
                swallowRunError(swallowRunErrorServiceName),
                throwOnAttemptEnd(listenerErrorServiceName),
                propagateAsyncContext,
              ],
            }
          : {}),
      });
    });

    afterAll(async () => {
      await env?.stop();
    });

    // -- tests --------------------------------------------------------------

    it("handler interceptor only", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(handlerOnlyService);
      const { invocationId } = await client.invoke("");
      const events = getEvents(invocationId);
      expect(events).toEqual([
        "hook:handler:before",
        "hook:handler:after",
        "hook:attemptEnd:success",
      ]);
    });

    it("handler + run interceptor", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(handlerRunService);
      const { invocationId } = await client.invoke("");
      const events = getEvents(invocationId);
      expect(events).toEqual([
        "hook:handler:before",
        "hook:run:step:before",
        "hook:run:step:after",
        "hook:handler:after",
        "hook:attemptEnd:success",
      ]);
    });

    it("handler with retry — no duplicate events", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(retryService);
      const { invocationId } = await client.invoke("");
      const events = getEvents(invocationId);
      expect(events).toEqual([
        // attempt 1: retryable error
        "hook:handler:before",
        "hook:handler:after",
        "hook:attemptEnd:retryableError",
        // attempt 2: success
        "hook:handler:before",
        "hook:handler:after",
        "hook:attemptEnd:success",
      ]);
    });

    it("terminal error", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(terminalService);
      const { events } = await invokeExpectingError(
        () => client.invoke("") as Promise<unknown>
      );
      expect(events).toEqual([
        "hook:handler:before",
        "hook:handler:after",
        "hook:attemptEnd:terminalError",
      ]);
    });

    it("attemptEnd receives the actual error for retryable errors", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(retryService);
      const { invocationId } = await client.invoke("");
      const results = getResults(invocationId);

      expect(results).toHaveLength(2);
      expect(results[0]!.type).toBe("retryableError");
      expect(
        (results[0] as { type: "retryableError"; error: Error }).error.message
      ).toBe("retry");
      expect(results[1]!.type).toBe("success");
    });

    it("attemptEnd receives the actual error for terminal errors", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(terminalService);
      const { invocationId } = await invokeExpectingError(
        () => client.invoke("") as Promise<unknown>
      );
      const results = getResults(invocationId!);

      expect(results).toHaveLength(1);
      expect(results[0]!.type).toBe("terminalError");
      expect(
        (results[0] as { type: "terminalError"; error: Error }).error.message
      ).toBe("terminal");
    });

    it("handler + run with retry — replayed run skips interceptor", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(retryWithReplayedRunService);
      const { invocationId } = await client.invoke("");
      const events = getEvents(invocationId);
      expect(events).toEqual([
        // attempt 1: step-1 executes, then retryable error
        "hook:handler:before",
        "hook:run:step-1:before",
        "hook:run:step-1:after",
        "hook:handler:after",
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
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(runRetryableService);
      const { invocationId } = await client.invoke("");
      const events = getEvents(invocationId);
      expect(events).toEqual([
        // attempt 1: run closure throws retryable error — attempt abandoned,
        // interceptor chain unwinds cleanly via abandonment signal
        "hook:handler:before",
        "hook:run:step:before",
        "hook:run:step:error",
        "hook:handler:after",
        "hook:attemptEnd:abandoned",
        // attempt 2: run closure succeeds
        "hook:handler:before",
        "hook:run:step:before",
        "hook:run:step:after",
        "hook:handler:after",
        "hook:attemptEnd:success",
      ]);
    });

    it("run throws terminal error", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(runTerminalService);
      const { events } = await invokeExpectingError(
        () => client.invoke("") as Promise<unknown>
      );
      expect(events).toEqual([
        "hook:handler:before",
        "hook:run:step:before",
        "hook:run:step:error",
        "hook:handler:after",
        "hook:attemptEnd:terminalError",
      ]);
    });

    it("call to non-existent service — handler:after and attemptEnd fire on each attempt", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(callNonExistentService);
      const { events } = await invokeExpectingError(
        () => client.invoke("") as Promise<unknown>
      );
      // The call error triggers invocation abandonment. The end of attempt 1
      // (handler:after, attemptEnd) may interleave with the start of attempt 2
      // (handler:before).
      const attemptEndOrStart = expect.stringMatching(
        /^hook:(handler:(before|after)|attemptEnd:abandoned)$/
      ) as unknown as string;
      expect(events).toEqual([
        // attempt 1 starts
        "hook:handler:before",
        // attempt 1 ends + attempt 2 starts (may interleave)
        attemptEndOrStart,
        attemptEndOrStart,
        attemptEndOrStart,
        // attempt 2 ends
        "hook:handler:after",
        "hook:attemptEnd:abandoned",
      ]);
    });

    it("hook provider error triggers retry then succeeds", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(providerErrorService);
      const { invocationId } = await client.invoke("");
      const events = getEvents(invocationId);
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
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(interceptorErrorService);
      const { invocationId } = await client.invoke("");
      const events = getEvents(invocationId);
      expect(events).toEqual([
        // attempt 1: recording hook's handler:before fires (outermost),
        // then error hook's interceptor throws — handler:after now fires (finally)
        "hook:handler:before",
        "hook:handler:after",
        "hook:attemptEnd:retryableError",
        // attempt 2: error hook's interceptor succeeds
        "hook:handler:before",
        "hook:handler:after",
        "hook:attemptEnd:success",
      ]);
    });

    it("run interceptor error triggers retry then succeeds", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(runInterceptorErrorService);
      const { invocationId } = await client.invoke("");
      const events = getEvents(invocationId);
      expect(events).toEqual([
        // attempt 1: handler starts, run interceptor throws — attempt abandoned,
        // interceptor chain unwinds cleanly via abandonment signal
        "hook:handler:before",
        "hook:run:step:before",
        "hook:run:step:error",
        "hook:handler:after",
        "hook:attemptEnd:abandoned",
        // attempt 2: run interceptor succeeds, run executes
        "hook:handler:before",
        "hook:run:step:before",
        "hook:run:step:after",
        "hook:handler:after",
        "hook:attemptEnd:success",
      ]);
    });

    it("handler interceptor terminal error after next()", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(handlerInterceptTerminalService);
      const { events } = await invokeExpectingError(
        () => client.invoke("") as Promise<unknown>
      );
      expect(events).toEqual([
        // recording hook's handler:before fires, then terminal hook runs
        // next() (handler completes), then throws — recording hook's
        // handler:after now fires (finally)
        "hook:handler:before",
        "hook:handler:after",
        "hook:attemptEnd:terminalError",
      ]);
    });

    it("run interceptor terminal error after next()", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(runInterceptTerminalService);
      const { events } = await invokeExpectingError(
        () => client.invoke("") as Promise<unknown>
      );
      expect(events).toEqual([
        // run executes successfully, then run interceptor throws terminal after next()
        "hook:handler:before",
        "hook:run:step:before",
        "hook:run:step:error",
        "hook:handler:after",
        "hook:attemptEnd:terminalError",
      ]);
    });

    it("run interceptor swallows error — run completes without error", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(swallowRunErrorService);
      const { invocationId } = await client.invoke("");
      const events = getEvents(invocationId);
      expect(events).toEqual([
        // The run closure throws TerminalError, but the swallow hook
        // catches it. The recording hook sees the run complete without error.
        "hook:handler:before",
        "hook:run:step:before",
        "hook:run:step:after",
        "hook:handler:after",
        "hook:attemptEnd:success",
      ]);
    });

    it("listener error is swallowed — does not affect execution", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(listenerErrorService);
      const { invocationId } = await client.invoke("");
      const events = getEvents(invocationId);
      // Handler succeeds despite listener throwing
      expect(events).toEqual([
        "hook:handler:before",
        "hook:handler:after",
        "hook:attemptEnd:success",
      ]);
    });

    it("attemptEnd with multiple retries then success", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(retryTwiceSuccessService);
      const { invocationId } = await client.invoke("");
      const events = getEvents(invocationId);
      expect(events).toEqual([
        "hook:handler:before",
        "hook:handler:after",
        "hook:attemptEnd:retryableError",
        "hook:handler:before",
        "hook:handler:after",
        "hook:attemptEnd:retryableError",
        "hook:handler:before",
        "hook:handler:after",
        "hook:attemptEnd:success",
      ]);
    });

    it("attemptEnd with multiple retries then terminal error", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(retryTwiceTerminalService);
      const { events } = await invokeExpectingError(
        () => client.invoke("") as Promise<unknown>
      );
      expect(events).toEqual([
        "hook:handler:before",
        "hook:handler:after",
        "hook:attemptEnd:retryableError",
        "hook:handler:before",
        "hook:handler:after",
        "hook:attemptEnd:retryableError",
        "hook:handler:before",
        "hook:handler:after",
        "hook:attemptEnd:terminalError",
      ]);
    });

    it("concurrent runs with progressive retries", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(concurrentRunService);
      const { invocationId } = await client.invoke("");
      const events = getEvents(invocationId);
      const anyRunBefore = expect.stringMatching(
        /^hook:run:run-[12]:before$/
      ) as unknown as string;
      // Between attempts, a stale run-2:error from the previous attempt can
      // race with the next attempt's handler:before
      const staleRunErrorOrNextAttemptStart = expect.stringMatching(
        /^hook:(run:run-2:error|handler:before)$/
      ) as unknown as string;
      expect(events).toEqual([
        // attempt 1: both runs start (order non-deterministic), run-1 fails
        "hook:handler:before",
        anyRunBefore,
        anyRunBefore,
        "hook:run:run-1:error",
        "hook:handler:after",
        "hook:attemptEnd:abandoned",
        // stale run-2:error from attempt 1 may arrive here, interleaved
        // with attempt 2's handler:before
        staleRunErrorOrNextAttemptStart,
        staleRunErrorOrNextAttemptStart,
        // attempt 2: both start, run-1 succeeds, run-2 fails
        anyRunBefore,
        anyRunBefore,
        "hook:run:run-1:after",
        "hook:run:run-2:error",
        "hook:handler:after",
        "hook:attemptEnd:abandoned",
        // attempt 3: run-1 replayed, run-2 succeeds
        "hook:handler:before",
        "hook:run:run-2:before",
        "hook:run:run-2:after",
        "hook:handler:after",
        "hook:attemptEnd:success",
      ]);
    });

    it("handler with suspension resumes and completes", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(suspendService);
      const { invocationId } = await client.invoke("");
      const events = getEvents(invocationId);
      expect(events).toEqual([
        // attempt 1: runs before-sleep, then suspends (inactivityTimeout: 100ms)
        // — abandonment signal unwinds the interceptor chain cleanly
        "hook:handler:before",
        "hook:run:before-sleep:before",
        "hook:run:before-sleep:after",
        "hook:handler:after",
        "hook:attemptEnd:abandoned",
        // attempt 2: replays before-sleep + sleep, then executes after-sleep
        "hook:handler:before",
        "hook:run:after-sleep:before",
        "hook:run:after-sleep:after",
        "hook:handler:after",
        "hook:attemptEnd:success",
      ]);
    });

    it("handler interceptor propagates async context to handler", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(asyncContextService);
      const { hookTag } = (await client.invoke("")) as {
        hookTag: string;
      };
      expect(hookTag).toBe("from-hook");
    });

    it("hooks provider receives correct HookContext for service", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(contextService);
      const { invocationId } = await client.invoke("");
      const ctx = getCapturedContext(invocationId);
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

      const ctx = getCapturedContext(invocationId);
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

  const orderingService = restate.service({
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

  beforeAll(async () => {
    env = await RestateTestEnvironment.start({
      services: [orderingService],
      hooks: [recordHookEvents("e1"), recordHookEvents("e2")],
    });
  });

  afterAll(async () => {
    await env?.stop();
  });

  it("endpoint -> service -> handler nesting with retries", async () => {
    const client = clients
      .connect({ url: env.baseUrl() })
      .serviceClient(orderingService);
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
      // handler:after unwinds innermost-first (finally block)
      "h2:handler:after",
      "h1:handler:after",
      "s2:handler:after",
      "s1:handler:after",
      "e2:handler:after",
      "e1:handler:after",
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
