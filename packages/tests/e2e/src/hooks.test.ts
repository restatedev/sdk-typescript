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
  getEvents as getHookEvents,
  getCapturedContext,
  captureContext,
  nextAttempt,
  recordHookEvents,
  throwOnFirstHookProviderCall,
  throwOnFirstHandlerIntercept,
  throwOnFirstRunIntercept,
  throwTerminalOnHandlerIntercept,
  throwTerminalOnRunIntercept,
  throwRetryableAfterHandlerNext,
  throwRetryableAfterRunNext,
  swallowRunError,
  invokeExpectingError,
  fastRetry,
  getInvocationOutcome,
  getRunJournalEntry,
  cancelInvocationViaAdminApi,
  pauseInvocationViaAdminApi,
  storeAwakeableId,
  getAwakeableId,
  resolveAwakeableViaIngress,
  rejectAwakeableViaIngress,
  inAnyOrder,
  wrapErrors,
} from "./test-utils.js";

function hooksSuite(level: HookLevel) {
  describe(`${level}-level hooks`, { timeout: 120_000 }, () => {
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
        awakeableSuccessService,
        awakeableRejectService,
        awakeableSerdeFailService,
        awakeableSerdeFailAfterRunService,
        suspendPerEntryService,
      ];
      env = await RestateTestEnvironment.start({
        services,
      });
    }, 120_000);

    afterAll(async () => {
      await env?.stop();
    });

    // -- tests --------------------------------------------------------------

    it("handler interceptor only", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(handlerOnlyService);
      const result = (await client.invoke("")) as { invocationId: string };
      const hookEvents = getHookEvents(result.invocationId);
      expect(hookEvents).toEqual(["hook:handler:before", "hook:handler:after"]);
      expect(
        await getInvocationOutcome(env.adminAPIBaseUrl(), result.invocationId)
      ).toMatchObject({
        status: "succeeded",
        journalOutput: { value: result },
      });
    });

    it("handler + run interceptor", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(handlerRunService);
      const result = (await client.invoke("")) as { invocationId: string };
      const hookEvents = getHookEvents(result.invocationId);
      expect(hookEvents).toEqual([
        "hook:handler:before",
        "hook:run:step:before",
        "hook:run:step:after",
        "hook:handler:after",
      ]);
      expect(
        await getInvocationOutcome(env.adminAPIBaseUrl(), result.invocationId)
      ).toMatchObject({
        status: "succeeded",
        journalOutput: { value: result },
      });
      expect(
        await getRunJournalEntry(env.adminAPIBaseUrl(), result.invocationId)
      ).toMatchObject({ value: "done" });
    });

    it("handler with retry — no duplicate events", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(retryService);
      const { invocationId } = await client.invoke("");
      const hookEvents = getHookEvents(invocationId);
      expect(hookEvents).toEqual([
        // attempt 1: retryable error
        "hook:handler:before",
        "hook:handler:error:[hw] retry",
        // attempt 2: success
        "hook:handler:before",
        "hook:handler:after",
      ]);
      expect(
        await getInvocationOutcome(env.adminAPIBaseUrl(), invocationId)
      ).toMatchObject({
        status: "succeeded",
        transientErrors: [{ error_code: 500, error_message: "[hw] retry" }],
      });
    });

    it("terminal error", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(terminalService);
      const { events: hookEvents, invocationId } = await invokeExpectingError(
        () => client.invoke("") as Promise<unknown>
      );
      expect(hookEvents).toEqual([
        "hook:handler:before",
        "hook:handler:error:[hw] terminal",
      ]);
      expect(
        await getInvocationOutcome(env.adminAPIBaseUrl(), invocationId!)
      ).toMatchObject({ status: "failed" });
    });

    it("handler + run with retry — replayed run skips interceptor", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(retryWithReplayedRunService);
      const { invocationId } = await client.invoke("");
      const hookEvents = getHookEvents(invocationId);
      expect(hookEvents).toEqual([
        // attempt 1: step-1 executes, then retryable error
        "hook:handler:before",
        "hook:run:step-1:before",
        "hook:run:step-1:after",
        "hook:handler:error:[hw] retry",
        // attempt 2: step-1 replayed (no interceptor), step-2 executes
        "hook:handler:before",
        "hook:run:step-2:before",
        "hook:run:step-2:after",
        "hook:handler:after",
      ]);
      expect(
        await getInvocationOutcome(env.adminAPIBaseUrl(), invocationId)
      ).toMatchObject({
        status: "succeeded",
        transientErrors: [{ error_code: 500, error_message: "[hw] retry" }],
      });
    });

    it("run throws retryable error then succeeds", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(runRetryableService);
      const { invocationId } = await client.invoke("");
      const hookEvents = getHookEvents(invocationId);
      expect(hookEvents).toEqual([
        // attempt 1: run closure throws retryable error — attempt abandoned,
        // handler:error still fires
        "hook:handler:before",
        "hook:run:step:before",
        "hook:run:step:error:[rw] run retryable fail",
        "hook:handler:error:[hw] (500) [rw] run retryable fail",
        // attempt 2: run closure succeeds
        "hook:handler:before",
        "hook:run:step:before",
        "hook:run:step:after",
        "hook:handler:after",
      ]);
      expect(
        await getInvocationOutcome(env.adminAPIBaseUrl(), invocationId)
      ).toMatchObject({
        status: "succeeded",
        transientErrors: [
          { error_code: 500, error_message: "[rw] run retryable fail" },
        ],
      });
    });

    it("run throws terminal error", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(runTerminalService);
      const { events: hookEvents, invocationId } = await invokeExpectingError(
        () => client.invoke("") as Promise<unknown>
      );
      expect(hookEvents).toEqual([
        "hook:handler:before",
        "hook:run:step:before",
        "hook:run:step:error:[rw] run fail",
        "hook:handler:error:[hw] [rw] run fail",
      ]);
      expect(
        await getInvocationOutcome(env.adminAPIBaseUrl(), invocationId!)
      ).toMatchObject({
        status: "failed",
        journalOutput: {
          failure: {
            message: expect.stringContaining("run fail") as string,
            metadata: { source: "run-closure", severity: "critical" },
          },
        },
      });
    });

    it("call to non-existent service — handler:error fires on each attempt", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceSendClient(callNonExistentService);
      const send = await client.invoke("");

      // The sent invocation's call error triggers invocation abandonment.
      // The end of attempt 1 (handler:error) may interleave with the start
      // of attempt 2 (handler:before).
      await expect
        .poll(() => getHookEvents(send.invocationId))
        .toEqual([
          // attempt 1 starts
          "hook:handler:before",
          // attempt 1 ends + attempt 2 starts (may interleave)
          ...inAnyOrder(
            "hook:handler:error:[hw] (599) Suspended invocation",
            "hook:handler:before"
          ),
          // attempt 2 ends
          "hook:handler:error:[hw] (599) Suspended invocation",
        ]);
    });

    it("hook provider error triggers retry then succeeds", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(providerErrorService);
      const { invocationId } = await client.invoke("");
      const hookEvents = getHookEvents(invocationId);
      expect(hookEvents).toEqual([
        // attempt 1: recording hook instantiated, then provider throws
        // — handler interceptor never started
        // attempt 2: all providers succeed, handler runs normally
        "hook:handler:before",
        "hook:handler:after",
      ]);
      expect(
        await getInvocationOutcome(env.adminAPIBaseUrl(), invocationId)
      ).toMatchObject({ status: "succeeded" });
    });

    it("interceptor error triggers retry then succeeds", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(interceptorErrorService);
      const { invocationId } = await client.invoke("");
      const hookEvents = getHookEvents(invocationId);
      expect(hookEvents).toEqual([
        // attempt 1: recording hook's handler:before fires (outermost),
        // then error hook's interceptor throws — handler:error fires (catch)
        "hook:handler:before",
        "hook:handler:error:[hw] interceptor retryable error",
        // attempt 2: error hook's interceptor succeeds
        "hook:handler:before",
        "hook:handler:after",
      ]);
      expect(
        await getInvocationOutcome(env.adminAPIBaseUrl(), invocationId)
      ).toMatchObject({
        status: "succeeded",
        transientErrors: [
          {
            error_code: 500,
            error_message: "[hw] interceptor retryable error",
          },
        ],
      });
    });

    it("run interceptor error triggers retry then succeeds", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(runInterceptorErrorService);
      const { invocationId } = await client.invoke("");
      const hookEvents = getHookEvents(invocationId);
      expect(hookEvents).toEqual([
        // attempt 1: handler starts, run interceptor throws — attempt abandoned,
        // handler:error still fires
        "hook:handler:before",
        "hook:run:step:before",
        "hook:run:step:error:[rw] run interceptor retryable error",
        "hook:handler:error:[hw] (500) [rw] run interceptor retryable error",
        // attempt 2: run interceptor succeeds, run executes
        "hook:handler:before",
        "hook:run:step:before",
        "hook:run:step:after",
        "hook:handler:after",
      ]);
      expect(
        await getInvocationOutcome(env.adminAPIBaseUrl(), invocationId)
      ).toMatchObject({
        status: "succeeded",
        transientErrors: [
          {
            error_code: 500,
            error_message: "[rw] run interceptor retryable error",
          },
        ],
      });
    });

    it("handler interceptor terminal error after next()", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(handlerInterceptTerminalService);
      const { events: hookEvents, invocationId } = await invokeExpectingError(
        () => client.invoke("") as Promise<unknown>
      );
      expect(hookEvents).toEqual([
        // Handler completes, then interceptor throws terminal error
        // after next(). The error fails the invocation.
        "hook:handler:before",
        "hook:handler:error:[hw] interceptor terminal error",
      ]);
      expect(
        await getInvocationOutcome(env.adminAPIBaseUrl(), invocationId!)
      ).toMatchObject({
        status: "failed",
        journalOutput: {
          failure: {
            message: expect.stringContaining(
              "interceptor terminal error"
            ) as string,
            metadata: {
              source: "handler-interceptor",
              severity: "critical",
            },
          },
        },
      });
    });

    it("run interceptor terminal error after next()", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(runInterceptTerminalService);
      const { events: hookEvents, invocationId } = await invokeExpectingError(
        () => client.invoke("") as Promise<unknown>
      );
      expect(hookEvents).toEqual([
        // Run completes, then run interceptor throws terminal error
        // after next(). The error fails the invocation.
        "hook:handler:before",
        "hook:run:step:before",
        "hook:run:step:error:[rw] run interceptor terminal error",
        "hook:handler:error:[hw] [rw] run interceptor terminal error",
      ]);
      expect(
        await getInvocationOutcome(env.adminAPIBaseUrl(), invocationId!)
      ).toMatchObject({
        status: "failed",
        journalOutput: {
          failure: {
            message: expect.stringContaining(
              "run interceptor terminal error"
            ) as string,
          },
        },
      });
    });

    it("handler interceptor retryable error after next() — retries then succeeds", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(handlerInterceptRetryableAfterNextService);
      const result = (await client.invoke("")) as { invocationId: string };
      const hookEvents = getHookEvents(result.invocationId);
      expect(hookEvents).toEqual([
        // attempt 1: handler completes, then interceptor throws retryable
        // error after next(). The error causes a retry.
        "hook:handler:before",
        "hook:handler:error:[hw] handler interceptor retryable after next",
        // attempt 2: interceptor does not throw, invocation succeeds
        "hook:handler:before",
        "hook:handler:after",
      ]);
      expect(
        await getInvocationOutcome(env.adminAPIBaseUrl(), result.invocationId)
      ).toMatchObject({
        status: "succeeded",
        journalOutput: { value: result },
        transientErrors: [
          {
            error_code: 500,
            error_message: "[hw] handler interceptor retryable after next",
          },
        ],
      });
    });

    it("run interceptor retryable error after next() — retries then succeeds", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(runInterceptRetryableAfterNextService);
      const result = (await client.invoke("")) as { invocationId: string };
      const hookEvents = getHookEvents(result.invocationId);
      expect(hookEvents).toEqual([
        // attempt 1: run completes, then run interceptor throws retryable
        // error after next(). The error triggers abandonment.
        "hook:handler:before",
        "hook:run:step:before",
        "hook:run:step:error:[rw] run interceptor retryable after next",
        "hook:handler:error:[hw] (500) [rw] run interceptor retryable after next",
        // attempt 2: run re-executes, interceptor does not throw, succeeds
        "hook:handler:before",
        "hook:run:step:before",
        "hook:run:step:after",
        "hook:handler:after",
      ]);
      expect(
        await getInvocationOutcome(env.adminAPIBaseUrl(), result.invocationId)
      ).toMatchObject({
        status: "succeeded",
        journalOutput: { value: result },
        transientErrors: [
          {
            error_code: 500,
            error_message: "[rw] run interceptor retryable after next",
          },
        ],
      });
      expect(
        await getRunJournalEntry(env.adminAPIBaseUrl(), result.invocationId)
      ).toMatchObject({ value: "done" });
    });

    it("run interceptor swallows error — run completes without error", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(swallowRunErrorService);
      const { invocationId } = await client.invoke("");
      const hookEvents = getHookEvents(invocationId);
      expect(hookEvents).toEqual([
        // The run closure throws TerminalError, but the swallow hook
        // catches it. The recording hook sees the run complete without error.
        "hook:handler:before",
        "hook:run:step:before",
        "hook:run:step:after",
        "hook:handler:after",
      ]);
      expect(
        await getInvocationOutcome(env.adminAPIBaseUrl(), invocationId)
      ).toMatchObject({ status: "succeeded" });
    });

    it("multiple retries then success", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(retryTwiceSuccessService);
      const { invocationId } = await client.invoke("");
      const hookEvents = getHookEvents(invocationId);
      expect(hookEvents).toEqual([
        "hook:handler:before",
        "hook:handler:error:[hw] retry",
        "hook:handler:before",
        "hook:handler:error:[hw] retry",
        "hook:handler:before",
        "hook:handler:after",
      ]);
      expect(
        await getInvocationOutcome(env.adminAPIBaseUrl(), invocationId)
      ).toMatchObject({
        status: "succeeded",
        transientErrors: [{ error_code: 500, error_message: "[hw] retry" }],
      });
    });

    it("multiple retries then terminal error", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(retryTwiceTerminalService);
      const { events: hookEvents, invocationId } = await invokeExpectingError(
        () => client.invoke("") as Promise<unknown>
      );
      expect(hookEvents).toEqual([
        "hook:handler:before",
        "hook:handler:error:[hw] retry",
        "hook:handler:before",
        "hook:handler:error:[hw] retry",
        "hook:handler:before",
        "hook:handler:error:[hw] terminal after retries",
      ]);
      expect(
        await getInvocationOutcome(env.adminAPIBaseUrl(), invocationId!)
      ).toMatchObject({
        status: "failed",
        transientErrors: [{ error_code: 500, error_message: "[hw] retry" }],
      });
    });

    it("concurrent runs with progressive retries", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(concurrentRunService);
      const { invocationId } = await client.invoke("");
      const hookEvents = getHookEvents(invocationId);
      expect(hookEvents).toEqual([
        // attempt 1: both runs start (order non-deterministic), run-1 fails.
        // run-2 aborts via attemptCompletedSignal — its interceptor sees "aborted".
        "hook:handler:before",
        ...inAnyOrder("hook:run:run-1:before", "hook:run:run-2:before"),
        "hook:run:run-1:error:[rw] run-1 fail",
        "hook:handler:error:[hw] (500) [rw] run-1 fail",
        "hook:run:run-2:error:[rw] aborted",
        // attempt 2: both runs start (order non-deterministic), run-1 succeeds, run-2 fails
        "hook:handler:before",
        ...inAnyOrder("hook:run:run-1:before", "hook:run:run-2:before"),
        "hook:run:run-1:after",
        "hook:run:run-2:error:[rw] run-2 fail",
        "hook:handler:error:[hw] (500) [rw] run-2 fail",
        // attempt 3: run-1 replayed, run-2 succeeds
        "hook:handler:before",
        "hook:run:run-2:before",
        "hook:run:run-2:after",
        "hook:handler:after",
      ]);
      const outcome = await getInvocationOutcome(
        env.adminAPIBaseUrl(),
        invocationId
      );
      const transientErrors = outcome.transientErrors ?? [];
      expect(outcome.status).toBe("succeeded");
      expect(transientErrors).toEqual([
        {
          error_code: 500,
          error_message: "[rw] run-1 fail",
          related_command_type: "Run",
          related_command_name: "run-1",
          related_command_index: 1,
        },
        {
          error_code: 500,
          error_message: "[rw] run-2 fail",
          related_command_type: "Run",
          related_command_name: "run-2",
          related_command_index: 2,
        },
      ]);
    });

    it("handler with suspension resumes and completes", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(suspendService);
      const { invocationId } = await client.invoke("");
      const hookEvents = getHookEvents(invocationId);
      expect(hookEvents).toEqual([
        // attempt 1: runs before-sleep, then suspends (inactivityTimeout: 100ms)
        // — handler:error still fires
        "hook:handler:before",
        "hook:run:before-sleep:before",
        "hook:run:before-sleep:after",
        "hook:handler:error:[hw] (599) Suspended invocation",
        // attempt 2: replays before-sleep + sleep, then executes after-sleep
        "hook:handler:before",
        "hook:run:after-sleep:before",
        "hook:run:after-sleep:after",
        "hook:handler:after",
      ]);
      expect(
        await getInvocationOutcome(env.adminAPIBaseUrl(), invocationId)
      ).toMatchObject({ status: "succeeded" });
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

    it("hooks provider receives correct request context for service", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(contextService);
      const { invocationId } = await client.invoke("");
      const req = getCapturedContext(invocationId);
      expect(req).toBeDefined();
      expect(req!.target.service).toBe(`${level}_Context`);
      expect(req!.target.handler).toBe("invoke");
      expect(req!.target.key).toBeUndefined();
      expect(req!.id).toBe(invocationId);
    });

    it("hooks provider receives correct request context with key for virtual object", async () => {
      const ingress = clients.connect({ url: env.baseUrl() });
      const client = ingress.objectClient(contextObj, "my-key");
      const { invocationId } = (await client.invoke("")) as {
        invocationId: string;
      };

      const req = getCapturedContext(invocationId);
      expect(req).toBeDefined();
      expect(req!.target.service).toBe(contextObjName);
      expect(req!.target.handler).toBe("invoke");
      expect(req!.target.key).toBe("my-key");
      expect(req!.id).toBe(invocationId);
    });

    it("input serde failure — terminal error", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(inputSerdeFailService);
      const { events: hookEvents } = await invokeExpectingError(
        () => client.invoke("") as Promise<unknown>
      );
      expect(hookEvents).toEqual([
        // attempt 1: input deserialization fails — terminal error (code 400)
        "hook:handler:before",
        "hook:handler:error:[hw] Failed to deserialize input: input serde failure",
      ]);
    });

    it("run serde failure — retries then killed", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(runSerdeFailService);
      const { events: hookEvents } = await invokeExpectingError(
        () => client.invoke("") as Promise<unknown>
      );
      expect(hookEvents).toEqual([
        // attempt 1: run succeeds but serialize throws — abandoned
        "hook:handler:before",
        "hook:run:step:before",
        "hook:run:step:after",
        "hook:handler:error:[hw] run serde failure",
        // attempt 2: same failure — abandoned, then killed (maxAttempts: 2)
        "hook:handler:before",
        "hook:run:step:before",
        "hook:run:step:after",
        "hook:handler:error:[hw] run serde failure",
      ]);
    });

    it("map() error after run — retryable then terminal", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(mapErrorService);
      const { events: hookEvents } = await invokeExpectingError(
        () => client.invoke("") as Promise<unknown>
      );
      expect(hookEvents).toEqual([
        // attempt 1: run succeeds, .map() throws retryable error — abandoned
        "hook:handler:before",
        "hook:run:step:before",
        "hook:run:step:after",
        "hook:handler:error:[hw] transient map error on: hello",
        // attempt 2: run replayed, .map() throws terminal error
        "hook:handler:before",
        "hook:handler:error:[hw] map failed on: hello",
      ]);
    });

    it("ctx.run with maxRetryAttempts — retries then terminal error", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(runMaxRetryService);
      const { events: hookEvents } = await invokeExpectingError(
        () => client.invoke("") as Promise<unknown>
      );
      expect(hookEvents).toEqual([
        // attempt 1: run fails — abandoned
        "hook:handler:before",
        "hook:run:flaky-step:before",
        "hook:run:flaky-step:error:[rw] always fails",
        "hook:handler:error:[hw] (500) [rw] always fails",
        // attempt 2: run fails — terminal (maxRetryAttempts exhausted)
        "hook:handler:before",
        "hook:run:flaky-step:before",
        "hook:run:flaky-step:error:[rw] always fails",
        "hook:handler:error:[hw] [rw] always fails",
      ]);
    });

    it("asTerminalError converts domain error to terminal", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(asTerminalErrorService);
      const { events: hookEvents } = await invokeExpectingError(
        () => client.invoke("") as Promise<unknown>
      );
      expect(hookEvents).toEqual([
        // attempt 1: run throws PaymentRejected, converted to terminal
        "hook:handler:before",
        "hook:run:charge:before",
        "hook:run:charge:error:Payment rejected",
        "hook:handler:error:Payment rejected",
      ]);
    });

    it("journal mismatch — retries then killed", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(journalMismatchService);
      const { events: hookEvents } = await invokeExpectingError(
        () => client.invoke("") as Promise<unknown>
      );
      expect(hookEvents).toEqual([
        // attempt 1: run "step-a" fails — abandoned
        "hook:handler:before",
        "hook:run:step-a:before",
        "hook:run:step-a:error:[rw] transient",
        "hook:handler:error:[hw] (500) [rw] transient",
        // attempt 2: run "step-b" mismatches journal — abandoned
        "hook:handler:before",
        "hook:handler:error:[hw] (570) Found a mismatch between the code paths taken during the previous exe...",
        // attempt 3: same mismatch — abandoned, then killed (maxAttempts: 3)
        "hook:handler:before",
        "hook:handler:error:[hw] (570) Found a mismatch between the code paths taken during the previous exe...",
      ]);
    });

    it("abort timeout — slow run aborted then succeeds on retry", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(abortTimeoutService);
      const { invocationId } = await client.invoke("");
      const hookEvents = getHookEvents(invocationId);
      expect(hookEvents).toEqual([
        // attempt 1: run listens to abort signal, aborts immediately — abandoned
        "hook:handler:before",
        "hook:run:slow-step:before",
        "hook:run:slow-step:error:[rw] aborted",
        "hook:handler:error:[hw] (500) [rw] aborted",
        // attempt 2: run completes quickly — success
        "hook:handler:before",
        "hook:run:slow-step:before",
        "hook:run:slow-step:after",
        "hook:handler:after",
      ]);
    });

    it("invocation cancelled in the middle of a run", async () => {
      const ingress = clients.connect({ url: env.baseUrl() });
      const send = await ingress
        .serviceSendClient(cancelDuringRunService)
        .invoke("");

      await expect
        .poll(() => getHookEvents(send.invocationId), {
          timeout: 5_000,
          interval: 100,
        })
        .toEqual(["hook:handler:before", "hook:run:slow-step:before"]);

      await cancelInvocationViaAdminApi(
        env.adminAPIBaseUrl(),
        send.invocationId
      );

      await expect
        .poll(() => getHookEvents(send.invocationId), {
          timeout: 5_000,
          interval: 100,
        })
        .toEqual([
          "hook:handler:before",
          "hook:run:slow-step:before",
          "hook:handler:error:[hw] Cancelled",
          "hook:run:slow-step:error:[rw] Cancelled",
        ]);

      expect(
        await getInvocationOutcome(env.adminAPIBaseUrl(), send.invocationId)
      ).toMatchObject({ status: "failed" });
    });

    it("cancelled invocation — run interceptor waits for closure to complete", async () => {
      const ingress = clients.connect({ url: env.baseUrl() });
      const send = await ingress
        .serviceSendClient(cancelDuringSlowRunService)
        .invoke("");

      // Wait for the slow-step to be in-flight
      await wait(100);

      // Cancel — the slow-step closure is still sleeping (~1s).
      // Cancel sends a CancelledError through the VM protocol.
      await cancelInvocationViaAdminApi(
        env.adminAPIBaseUrl(),
        send.invocationId
      );

      // handler:error fires immediately (broken out by raceWithAttemptEnd).
      await expect
        .poll(() => getHookEvents(send.invocationId), {
          timeout: 5_000,
          interval: 100,
        })
        .toEqual([
          "hook:handler:before",
          "hook:run:slow-step:before",
          "hook:handler:error:[hw] Cancelled",
        ]);

      // run:after fires only after the closure finishes (~1s). The run
      // interceptor is NOT broken out — it waits for the closure to
      // complete. The :after (not :error) proves it completed normally.
      await expect
        .poll(() => getHookEvents(send.invocationId), {
          timeout: 5_000,
          interval: 100,
        })
        .toEqual([
          "hook:handler:before",
          "hook:run:slow-step:before",
          "hook:handler:error:[hw] Cancelled",
          "hook:run:slow-step:after",
        ]);

      expect(
        await getInvocationOutcome(env.adminAPIBaseUrl(), send.invocationId)
      ).toMatchObject({ status: "failed" });
    });

    it("invocation pause requested in the middle of a run", async () => {
      const ingress = clients.connect({ url: env.baseUrl() });
      const send = await ingress
        .serviceSendClient(pauseDuringRunService)
        .invoke("");

      await expect
        .poll(() => getHookEvents(send.invocationId), {
          timeout: 5_000,
          interval: 100,
        })
        .toEqual(["hook:handler:before", "hook:run:slow-step:before"]);

      await pauseInvocationViaAdminApi(
        env.adminAPIBaseUrl(),
        send.invocationId
      );

      await expect
        .poll(() => getHookEvents(send.invocationId), {
          timeout: 10_000,
          interval: 100,
        })
        .toEqual([
          "hook:handler:before",
          "hook:run:slow-step:before",
          "hook:run:slow-step:after",
          "hook:handler:error:[hw] (599) Suspended invocation",
        ]);

      await expect
        .poll(
          () => getInvocationOutcome(env.adminAPIBaseUrl(), send.invocationId),
          {
            timeout: 10_000,
            interval: 100,
          }
        )
        .toMatchObject({ status: "paused" });
    });

    it("Always replay — suspend and replay after each entry", async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(suspendPerEntryService);
      const { invocationId } = await client.invoke("");
      const hookEvents = getHookEvents(invocationId);
      expect(hookEvents).toEqual([
        "hook:handler:before",
        "hook:run:step-1:before",
        "hook:run:step-1:error:[rw] step-1 transient",
        "hook:handler:error:[hw] (500) [rw] step-1 transient",
        "hook:handler:before",
        "hook:run:step-1:before",
        "hook:run:step-1:after",
        "hook:handler:error:[hw] (599) Suspended invocation",
        "hook:handler:before",
        "hook:run:step-2:before",
        "hook:run:step-2:after",
        "hook:handler:error:[hw] (599) Suspended invocation",
        "hook:handler:before",
        "hook:handler:after",
      ]);
    });

    // -- awakeable tests ----------------------------------------------------

    it("awakeable success — resolved via ingress", async () => {
      const ingress = clients.connect({ url: env.baseUrl() });
      const send = await ingress
        .serviceSendClient(awakeableSuccessService)
        .invoke("");

      // Wait for the handler to create the awakeable
      await expect
        .poll(() => getAwakeableId(send.invocationId), {
          timeout: 5_000,
          interval: 100,
        })
        .toBeTruthy();

      // Resolve via ingress
      await resolveAwakeableViaIngress(
        env.baseUrl(),
        getAwakeableId(send.invocationId)!,
        "hello"
      );

      await expect
        .poll(() => getHookEvents(send.invocationId), {
          timeout: 5_000,
          interval: 100,
        })
        .toEqual(["hook:handler:before", "hook:handler:after"]);
    });

    it("awakeable reject via ingress — terminal error", async () => {
      const ingress = clients.connect({ url: env.baseUrl() });
      const send = await ingress
        .serviceSendClient(awakeableRejectService)
        .invoke("");

      // Wait for the handler to create the awakeable
      await expect
        .poll(() => getAwakeableId(send.invocationId), {
          timeout: 5_000,
          interval: 100,
        })
        .toBeTruthy();

      // Reject via ingress
      await rejectAwakeableViaIngress(
        env.baseUrl(),
        getAwakeableId(send.invocationId)!,
        "awakeable rejected"
      );

      await expect
        .poll(() => getHookEvents(send.invocationId), {
          timeout: 5_000,
          interval: 100,
        })
        .toEqual([
          "hook:handler:before",
          "hook:handler:error:[hw] awakeable rejected",
        ]);

      expect(
        await getInvocationOutcome(env.adminAPIBaseUrl(), send.invocationId)
      ).toMatchObject({
        status: "failed",
        journalOutput: {
          failure: {
            message: expect.stringContaining("awakeable rejected") as string,
          },
        },
      });
    });

    it("awakeable serde failure — retries then succeeds", async () => {
      const ingress = clients.connect({ url: env.baseUrl() });
      const send = await ingress
        .serviceSendClient(awakeableSerdeFailService)
        .invoke("");

      // Wait for the handler to create the awakeable (attempt 1)
      await expect
        .poll(() => getAwakeableId(send.invocationId), {
          timeout: 5_000,
          interval: 100,
        })
        .toBeTruthy();

      // Resolve via ingress — serde will fail on deserialize (attempt 1)
      await resolveAwakeableViaIngress(
        env.baseUrl(),
        getAwakeableId(send.invocationId)!,
        "hello"
      );

      // Attempt 1 fails, attempt 2 replays the awakeable with good serde
      await expect
        .poll(() => getHookEvents(send.invocationId), {
          timeout: 10_000,
          interval: 100,
        })
        .toEqual([
          // attempt 1: awakeable serde fails on deserialize → CommandError
          // (sanitized — interceptor does not see commandType)
          "hook:handler:before",
          "hook:handler:error:[hw] awakeable serde fail",
          // attempt 2: replayed awakeable with good serde succeeds
          "hook:handler:before",
          "hook:handler:after",
        ]);

      await expect
        .poll(() =>
          getInvocationOutcome(env.adminAPIBaseUrl(), send.invocationId)
        )
        .toMatchObject({
          status: "succeeded",
          transientErrors: [
            { error_code: 500, error_message: "awakeable serde fail" },
          ],
        });
    });

    it("awakeable serde failure after prior run does not inherit stale run metadata", async () => {
      const ingress = clients.connect({ url: env.baseUrl() });
      const send = await ingress
        .serviceSendClient(awakeableSerdeFailAfterRunService)
        .invoke("");

      await expect
        .poll(() => getAwakeableId(send.invocationId), {
          timeout: 5_000,
          interval: 100,
        })
        .toBeTruthy();

      await resolveAwakeableViaIngress(
        env.baseUrl(),
        getAwakeableId(send.invocationId)!,
        "hello"
      );

      await expect
        .poll(() => getHookEvents(send.invocationId), {
          timeout: 10_000,
          interval: 100,
        })
        .toEqual([
          "hook:handler:before",
          "hook:run:setup:before",
          "hook:run:setup:after",
          "hook:handler:error:[hw] awakeable serde fail",
          "hook:handler:before",
          "hook:handler:after",
        ]);

      const outcome = await getInvocationOutcome(
        env.adminAPIBaseUrl(),
        send.invocationId
      );
      const transientErrors = outcome.transientErrors ?? [];
      expect(outcome.status).toBe("succeeded");
      expect(transientErrors).toEqual([
        { error_code: 500, error_message: "awakeable serde fail" },
      ]);
    });
  });
}

// ---------------------------------------------------------------------------
// Generate suites for each level
// ---------------------------------------------------------------------------

hooksSuite("handler");
hooksSuite("service");

describe("default service hook overriding", { timeout: 120_000 }, () => {
  let env: RestateTestEnvironment;

  const overrideService = restate.service({
    name: "ServiceOverridesDefaultHooks",
    handlers: {
      invoke: (ctx: restate.Context, _input: string) =>
        Promise.resolve({ invocationId: ctx.request().id }),
    },
    options: {
      hooks: [recordHookEvents("service")],
    },
  });

  beforeAll(async () => {
    env = await RestateTestEnvironment.start({
      services: [overrideService],
      defaultServiceOptions: {
        hooks: [recordHookEvents("default")],
      },
    });
  }, 120_000);

  afterAll(async () => {
    await env?.stop();
  });

  it("service hooks override default service hooks", async () => {
    const client = clients
      .connect({ url: env.baseUrl() })
      .serviceClient(overrideService);
    const { invocationId } = (await client.invoke("")) as {
      invocationId: string;
    };

    expect(getHookEvents(invocationId)).toEqual([
      "service:handler:before",
      "service:handler:after",
    ]);
  });
});

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
      defaultServiceOptions: {
        hooks: [recordHookEvents("d1"), recordHookEvents("d2")],
      },
    });
  }, 120_000);

  afterAll(async () => {
    await env?.stop();
  });

  it("service and handler hooks compose across retries", async () => {
    const client = clients
      .connect({ url: env.baseUrl() })
      .serviceClient(orderingService);
    const { invocationId } = (await client.invoke("")) as {
      invocationId: string;
    };

    expect(getHookEvents(invocationId)).toEqual([
      // ---- attempt 1: step-1 succeeds, then retryable error ----
      // service hooks override defaultServiceOptions.hooks, so only
      // service + handler hooks participate here.
      "s1:handler:before",
      "s2:handler:before",
      "h1:handler:before",
      "h2:handler:before",
      // run interceptors for step-1
      "s1:run:step-1:before",
      "s2:run:step-1:before",
      "h1:run:step-1:before",
      "h2:run:step-1:before",
      // run:after unwinds innermost-first
      "h2:run:step-1:after",
      "h1:run:step-1:after",
      "s2:run:step-1:after",
      "s1:run:step-1:after",
      // handler:error unwinds innermost-first (catch block)
      "h2:handler:error:retry",
      "h1:handler:error:retry",
      "s2:handler:error:retry",
      "s1:handler:error:retry",

      // ---- attempt 2: step-1 replayed, step-2 executes, success ----
      "s1:handler:before",
      "s2:handler:before",
      "h1:handler:before",
      "h2:handler:before",
      // step-1 replayed — no run interceptor events
      // run interceptors for step-2
      "s1:run:step-2:before",
      "s2:run:step-2:before",
      "h1:run:step-2:before",
      "h2:run:step-2:before",
      "h2:run:step-2:after",
      "h1:run:step-2:after",
      "s2:run:step-2:after",
      "s1:run:step-2:after",
      // handler:after unwinds innermost-first
      "h2:handler:after",
      "h1:handler:after",
      "s2:handler:after",
      "s1:handler:after",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Transient error command metadata (kitchen sink)
// ---------------------------------------------------------------------------

describe("transient error command metadata", { timeout: 120_000 }, () => {
  let env: RestateTestEnvironment;

  // Per-invocation attempt counter, incremented in the hook provider so both
  // the hook interceptors and handler read the same attempt number.
  const ksAttempts = new Map<string, number>();

  const ksHook: HooksProvider = (ctx) => {
    const id = ctx.request.id;
    const attempt = (ksAttempts.get(id) ?? 0) + 1;
    ksAttempts.set(id, attempt);

    return {
      interceptor: {
        handler: async (next) => {
          // Attempt 5: handler interceptor throws before next()
          if (attempt === 5) throw new Error("handler-interceptor boom");
          await next();
        },
        run: async (name, next) => {
          // Attempt 3: run interceptor throws before next() on step-3
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

  // Kitchen sink service that exercises many failure modes on known attempts.
  // The attempt ordering is chosen carefully so that runs are journaled in
  // the right order — a failure mode must occur BEFORE the affected run is
  // ever successfully journaled, otherwise it would just be replayed.
  //
  // Attempt 1: handler throws directly (no command)
  // Attempt 2: ctx.run("step-1") closure fails
  // Attempt 3: step-1 ok, step-2 ok, step-3 run interceptor throws (before next)
  // Attempt 4: step-1,2 replay, step-3 ok, step-4 serde.serialize fails
  // Attempt 5: step-1,2,3 replay, handler interceptor throws (before next)
  // Attempt 6: step-1,2,3 replay, step-4 ok, step-5 ok, handler throws
  // Attempt 7: replay through step-4, "MISMATCH" at step-5 pos → mismatch, killed
  const kitchenSinkService = createService({
    name: "KitchenSink_TransientErrors",
    serviceHooks: [ksHook],
    handler: async (ctx, _) => {
      const id = ctx.request().id;
      const attempt = ksAttempts.get(id) ?? 1;

      // Attempt 1: handler throws before any command
      if (attempt === 1) throw new Error("handler boom");

      // Attempt 2+: first run
      await ctx.run("step-1", () => {
        if (attempt === 2) throw new Error("step-1 boom");
        return "a";
      });

      // Attempt 3+: step-2 always succeeds
      await ctx.run("step-2", () => "b");

      // Attempt 3: run interceptor throws on step-3 (before next)
      // Attempt 4+: step-3 executes normally
      await ctx.run("step-3", () => "c");

      // Attempt 4: serde.serialize fails on step-4
      await ctx.run(
        "step-4",
        () => "d",
        attempt === 4 ? { serde: failingSerializeSerde } : {}
      );

      // Attempt 6: step-5 ok, then handler throws to set up mismatch
      // Attempt 7: name changes to "MISMATCH" → journal mismatch
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

  beforeAll(async () => {
    env = await RestateTestEnvironment.start({
      services: [kitchenSinkService],
    });
  }, 120_000);

  afterAll(async () => {
    await env?.stop();
  });

  it("transient errors carry correct command metadata per failure type", async () => {
    const ingress = clients.connect({ url: env.baseUrl() });
    const send = await ingress.serviceSendClient(kitchenSinkService).invoke("");

    // Wait for invocation to complete (killed after maxAttempts)
    await expect
      .poll(
        () => getInvocationOutcome(env.adminAPIBaseUrl(), send.invocationId),
        { timeout: 30_000, interval: 200 }
      )
      .toMatchObject({
        status: expect.stringMatching(/succeeded|failed/) as string,
      });

    const outcome = await getInvocationOutcome(
      env.adminAPIBaseUrl(),
      send.invocationId
    );
    const allErrors = outcome.transientErrors ?? [];

    expect(allErrors).toEqual([
      {
        error_code: 500,
        error_message: "handler boom",
      },
      {
        error_code: 500,
        error_message: "step-1 boom",
        related_command_type: "Run",
        related_command_name: "step-1",
        related_command_index: 1,
      },
      {
        error_code: 500,
        error_message: "run-interceptor boom",
        related_command_type: "Run",
        related_command_name: "step-3",
        related_command_index: 3,
      },
      {
        error_code: 500,
        error_message: "serde boom",
      },
      {
        error_code: 500,
        error_message: "handler-interceptor boom",
      },
      {
        error_code: 500,
        error_message: "pre-mismatch",
      },
      {
        error_code: 570,
        error_message: expect.stringContaining(
          "Found a mismatch between the code paths taken during the previous exe"
        ) as string,
        related_command_type: "Run",
        related_command_name: "MISMATCH",
        related_command_index: 5,
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Interceptor error isolation
// ---------------------------------------------------------------------------

describe("interceptor error isolation", { timeout: 120_000 }, () => {
  let env: RestateTestEnvironment;

  // Collects SDK-internal metadata (CommandError) seen by interceptors,
  // keyed by invocationId. If the SDK correctly isolates internals, these
  // lists stay empty.
  const leakedMetadata = new Map<
    string,
    { commandType: string[]; commandIndex: string[] }
  >();

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const obj = e as Record<string, any>;
    if (obj.commandType !== undefined)
      leaksFor(id).commandType.push(`${source}: ${e.message}`);
    if (obj.commandIndex !== undefined)
      leaksFor(id).commandIndex.push(`${source}: ${e.message}`);
  }

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

  // Service that triggers a CommandError — verifies interceptors never see
  // commandType/commandIndex on caught errors.
  //
  // Attempt 1: ctx.sleep(NaN) → BigInt(NaN) throws in prepare step →
  //   rejectAttempt(e, WasmCommandType.Sleep) → CommandError
  // Attempt 2: succeeds
  const metadataLeakService = createService({
    name: "ErrorIsolation_MetadataLeak",
    serviceHooks: [recordLeakedMetadata],
    handler: async (ctx, _) => {
      const attempt = nextAttempt(ctx.request().id);
      await ctx.sleep(attempt === 1 ? NaN : 10);
      return { invocationId: ctx.request().id };
    },
    options: fastRetry,
  });

  // Service where both run and handler interceptors catch errors and rethrow
  // RetryableError with retryAfter — verifies the SDK does NOT let
  // interceptor-thrown RetryableError override retry timing.
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

  const withCustomRetryAfterService = createService({
    name: "ErrorIsolation_CustomRetryAfter",
    serviceHooks: [overrideRetryAfterHook],
    handler: async (ctx, _) => {
      const attempt = nextAttempt(ctx.request().id);
      // Attempt 1: run throws — tests run interceptor RetryableError path
      await ctx.run("step", () => {
        if (attempt === 1) throw new Error("run failed");
        return "done";
      });
      // Attempt 2: handler throws directly — tests handler interceptor path
      if (attempt === 2) throw new Error("handler failed");
      // Attempt 3: succeeds
      return { invocationId: ctx.request().id };
    },
    options: {
      retryPolicy: {
        initialInterval: 120_000,
      },
    },
  });

  beforeAll(async () => {
    env = await RestateTestEnvironment.start({
      services: [metadataLeakService, withCustomRetryAfterService],
    });
  }, 120_000);

  afterAll(async () => {
    await env?.stop();
  });

  it("interceptors do not see SDK-internal metadata on caught errors", async () => {
    const client = clients
      .connect({ url: env.baseUrl() })
      .serviceClient(metadataLeakService);
    const { invocationId } = await client.invoke("");

    const leaks = leakedMetadata.get(invocationId);
    expect(leaks?.commandType ?? []).toHaveLength(0);
    expect(leaks?.commandIndex ?? []).toHaveLength(0);
  });

  it(
    "interceptor-thrown RetryableError does affect retry timing",
    { timeout: 5_000 },
    async () => {
      const client = clients
        .connect({ url: env.baseUrl() })
        .serviceClient(withCustomRetryAfterService);
      const { invocationId } = await client.invoke("");

      // overrideRetryAfterHook throws RetryableError with retryAfter: 120_000.
      // If the SDK honored it, the retry would wait 2 minutes and this test
      // would timeout (5s). With fastRetry (10ms interval), it completes fast.
      expect(
        await getInvocationOutcome(env.adminAPIBaseUrl(), invocationId)
      ).toMatchObject({ status: "succeeded" });
    }
  );
});
