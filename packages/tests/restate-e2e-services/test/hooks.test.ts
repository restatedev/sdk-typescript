// Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
//
// This file is part of the Restate e2e tests,
// which are released under the MIT license.
//
// You can find a copy of the license in file LICENSE in the root
// directory of this repository or package, or at
// https://github.com/restatedev/e2e/blob/main/LICENSE

import { describe, it, expect } from "vitest";
import * as clients from "@restatedev/restate-sdk-clients";
import { setTimeout as delay } from "node:timers/promises";
import { getAdminUrl, getIngressUrl } from "./utils.js";
import {
  cancelInvocationViaAdminApi,
  getRunJournalEntry,
  hooksDriver,
  inAnyOrder,
  invokeExpectingError,
  pauseInvocationViaAdminApi,
  waitForInvocationOutcome,
} from "./hooks_utils.js";
import {
  hookSuites,
  kitchenSinkService,
  metadataLeakService,
  orderingService,
  overrideService,
  withCustomRetryAfterService,
  type HookLevel,
} from "../src/hooks.js";

function hooksSuite(level: HookLevel) {
  describe(`${level}-level hooks`, { timeout: 120_000 }, () => {
    const {
      handlerOnlyService,
      handlerRunService,
      retryService,
      terminalService,
      retryWithReplayedRunService,
      runRetryableService,
      runTerminalService,
      callNonExistentService,
      providerErrorService,
      interceptorErrorService,
      runInterceptorErrorService,
      handlerInterceptTerminalService,
      runInterceptTerminalService,
      handlerInterceptRetryableAfterNextService,
      runInterceptRetryableAfterNextService,
      swallowRunErrorService,
      retryTwiceSuccessService,
      retryTwiceTerminalService,
      concurrentRunService,
      suspendService,
      asyncContextService,
      contextService,
      contextObj,
      contextObjName,
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
    } = hookSuites[level];

    it("handler interceptor only", async () => {
      const client = clients
        .connect({ url: getIngressUrl() })
        .serviceClient(handlerOnlyService);
      const result = (await client.invoke("")) as { invocationId: string };
      const hookEvents = await hooksDriver.getEvents(result.invocationId);
      expect(hookEvents).toEqual(["hook:handler:before", "hook:handler:after"]);
      await waitForInvocationOutcome(getAdminUrl(), result.invocationId, {
        status: "succeeded",
        journalOutput: { value: result },
      });
    });

    it("handler + run interceptor", async () => {
      const client = clients
        .connect({ url: getIngressUrl() })
        .serviceClient(handlerRunService);
      const result = (await client.invoke("")) as { invocationId: string };
      const hookEvents = await hooksDriver.getEvents(result.invocationId);
      expect(hookEvents).toEqual([
        "hook:handler:before",
        "hook:run:step:before",
        "hook:run:step:after",
        "hook:handler:after",
      ]);
      await waitForInvocationOutcome(getAdminUrl(), result.invocationId, {
        status: "succeeded",
        journalOutput: { value: result },
      });
      expect(
        await getRunJournalEntry(getAdminUrl(), result.invocationId)
      ).toMatchObject({ value: "done" });
    });

    it("handler with retry — no duplicate events", async () => {
      const client = clients
        .connect({ url: getIngressUrl() })
        .serviceClient(retryService);
      const { invocationId } = await client.invoke("");
      const hookEvents = await hooksDriver.getEvents(invocationId);
      expect(hookEvents).toEqual([
        // attempt 1: retryable error
        "hook:handler:before",
        "hook:handler:error:[hw] retry",
        // attempt 2: success
        "hook:handler:before",
        "hook:handler:after",
      ]);
      await waitForInvocationOutcome(getAdminUrl(), invocationId, {
        status: "succeeded",
        transientErrors: [{ error_code: 500, error_message: "[hw] retry" }],
      });
    });

    it("terminal error", async () => {
      const client = clients
        .connect({ url: getIngressUrl() })
        .serviceClient(terminalService);
      const { events: hookEvents, invocationId } = await invokeExpectingError(
        () => client.invoke("") as Promise<unknown>
      );
      expect(hookEvents).toEqual([
        "hook:handler:before",
        "hook:handler:error:[hw] terminal",
      ]);
      await waitForInvocationOutcome(getAdminUrl(), invocationId!, {
        status: "failed",
      });
    });

    it("handler + run with retry — replayed run skips interceptor", async () => {
      const client = clients
        .connect({ url: getIngressUrl() })
        .serviceClient(retryWithReplayedRunService);
      const { invocationId } = await client.invoke("");
      const hookEvents = await hooksDriver.getEvents(invocationId);
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
      await waitForInvocationOutcome(getAdminUrl(), invocationId, {
        status: "succeeded",
        transientErrors: [{ error_code: 500, error_message: "[hw] retry" }],
      });
    });

    it("run throws retryable error then succeeds", async () => {
      const client = clients
        .connect({ url: getIngressUrl() })
        .serviceClient(runRetryableService);
      const { invocationId } = await client.invoke("");
      const hookEvents = await hooksDriver.getEvents(invocationId);
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
      await waitForInvocationOutcome(getAdminUrl(), invocationId, {
        status: "succeeded",
        transientErrors: [
          { error_code: 500, error_message: "[rw] run retryable fail" },
        ],
      });
    });

    it("run throws terminal error", async () => {
      const client = clients
        .connect({ url: getIngressUrl() })
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
      await waitForInvocationOutcome(getAdminUrl(), invocationId!, {
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
        .connect({ url: getIngressUrl() })
        .serviceSendClient(callNonExistentService);
      const send = await client.invoke("");

      // The sent invocation's call error triggers invocation abandonment.
      // The end of attempt 1 (handler:error) may interleave with the start
      // of attempt 2 (handler:before).
      await expect
        .poll(() => hooksDriver.getEvents(send.invocationId))
        .toEqual([
          // attempt 1 starts
          "hook:handler:before",
          // attempt 1 ends + attempt 2 starts (may interleave)
          expect.toSatisfy(
            (v: string) =>
              v.includes("hook:handler:error:[hw]") ||
              v.includes("hook:handler:before")
          ),
          expect.toSatisfy(
            (v: string) =>
              v.includes("hook:handler:error:[hw]") ||
              v.includes("hook:handler:before")
          ),
          // attempt 2 ends
          expect.stringContaining("hook:handler:error:[hw]"),
        ]);
    });

    it("hook provider error triggers retry then succeeds", async () => {
      const client = clients
        .connect({ url: getIngressUrl() })
        .serviceClient(providerErrorService);
      const { invocationId } = await client.invoke("");
      const hookEvents = await hooksDriver.getEvents(invocationId);
      expect(hookEvents).toEqual([
        // attempt 1: recording hook instantiated, then provider throws
        // — handler interceptor never started
        // attempt 2: all providers succeed, handler runs normally
        "hook:handler:before",
        "hook:handler:after",
      ]);
      await waitForInvocationOutcome(getAdminUrl(), invocationId, {
        status: "succeeded",
      });
    });

    it("interceptor error triggers retry then succeeds", async () => {
      const client = clients
        .connect({ url: getIngressUrl() })
        .serviceClient(interceptorErrorService);
      const { invocationId } = await client.invoke("");
      const hookEvents = await hooksDriver.getEvents(invocationId);
      expect(hookEvents).toEqual([
        // attempt 1: recording hook's handler:before fires (outermost),
        // then error hook's interceptor throws — handler:error fires (catch)
        "hook:handler:before",
        "hook:handler:error:[hw] interceptor retryable error",
        // attempt 2: error hook's interceptor succeeds
        "hook:handler:before",
        "hook:handler:after",
      ]);
      await waitForInvocationOutcome(getAdminUrl(), invocationId, {
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
        .connect({ url: getIngressUrl() })
        .serviceClient(runInterceptorErrorService);
      const { invocationId } = await client.invoke("");
      const hookEvents = await hooksDriver.getEvents(invocationId);
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
      await waitForInvocationOutcome(getAdminUrl(), invocationId, {
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
        .connect({ url: getIngressUrl() })
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
      await waitForInvocationOutcome(getAdminUrl(), invocationId!, {
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
        .connect({ url: getIngressUrl() })
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
      await waitForInvocationOutcome(getAdminUrl(), invocationId!, {
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
        .connect({ url: getIngressUrl() })
        .serviceClient(handlerInterceptRetryableAfterNextService);
      const result = (await client.invoke("")) as { invocationId: string };
      const hookEvents = await hooksDriver.getEvents(result.invocationId);
      expect(hookEvents).toEqual([
        // attempt 1: handler completes, then interceptor throws retryable
        // error after next(). The error causes a retry.
        "hook:handler:before",
        "hook:handler:error:[hw] handler interceptor retryable after next",
        // attempt 2: interceptor does not throw, invocation succeeds
        "hook:handler:before",
        "hook:handler:after",
      ]);
      await waitForInvocationOutcome(getAdminUrl(), result.invocationId, {
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
        .connect({ url: getIngressUrl() })
        .serviceClient(runInterceptRetryableAfterNextService);
      const result = (await client.invoke("")) as { invocationId: string };
      const hookEvents = await hooksDriver.getEvents(result.invocationId);
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
      await waitForInvocationOutcome(getAdminUrl(), result.invocationId, {
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
        await getRunJournalEntry(getAdminUrl(), result.invocationId)
      ).toMatchObject({ value: "done" });
    });

    it("run interceptor swallows error — run completes without error", async () => {
      const client = clients
        .connect({ url: getIngressUrl() })
        .serviceClient(swallowRunErrorService);
      const { invocationId } = await client.invoke("");
      const hookEvents = await hooksDriver.getEvents(invocationId);
      expect(hookEvents).toEqual([
        // The run closure throws TerminalError, but the swallow hook
        // catches it. The recording hook sees the run complete without error.
        "hook:handler:before",
        "hook:run:step:before",
        "hook:run:step:after",
        "hook:handler:after",
      ]);
      await waitForInvocationOutcome(getAdminUrl(), invocationId, {
        status: "succeeded",
      });
    });

    it("multiple retries then success", async () => {
      const client = clients
        .connect({ url: getIngressUrl() })
        .serviceClient(retryTwiceSuccessService);
      const { invocationId } = await client.invoke("");
      const hookEvents = await hooksDriver.getEvents(invocationId);
      expect(hookEvents).toEqual([
        "hook:handler:before",
        "hook:handler:error:[hw] retry",
        "hook:handler:before",
        "hook:handler:error:[hw] retry",
        "hook:handler:before",
        "hook:handler:after",
      ]);
      await waitForInvocationOutcome(getAdminUrl(), invocationId, {
        status: "succeeded",
        transientErrors: [{ error_code: 500, error_message: "[hw] retry" }],
      });
    });

    it("multiple retries then terminal error", async () => {
      const client = clients
        .connect({ url: getIngressUrl() })
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
      await waitForInvocationOutcome(getAdminUrl(), invocationId!, {
        status: "failed",
        transientErrors: [{ error_code: 500, error_message: "[hw] retry" }],
      });
    });

    it("concurrent runs with progressive retries", async () => {
      const client = clients
        .connect({ url: getIngressUrl() })
        .serviceClient(concurrentRunService);
      const { invocationId } = await client.invoke("");
      const hookEvents = await hooksDriver.getEvents(invocationId);
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
      const outcome = await waitForInvocationOutcome(
        getAdminUrl(),
        invocationId,
        {
          status: "succeeded",
        }
      );
      const transientErrors = outcome.transientErrors ?? [];
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
      const ingress = clients.connect({ url: getIngressUrl() });
      const send = await ingress.serviceSendClient(suspendService).invoke("");

      await expect
        .poll(() => hooksDriver.getAwakeableId(send.invocationId), {
          timeout: 5_000,
          interval: 100,
        })
        .toBeTruthy();

      await expect
        .poll(() => hooksDriver.getEvents(send.invocationId), {
          timeout: 5_000,
          interval: 100,
        })
        .toEqual([
          // attempt 1: runs before-suspend, then suspends (inactivityTimeout: 100ms)
          // handler:error still fires
          "hook:handler:before",
          "hook:run:before-suspend:before",
          "hook:run:before-suspend:after",
          "hook:handler:error:[hw] (599) Suspended invocation",
        ]);

      await ingress.resolveAwakeable(
        (await hooksDriver.getAwakeableId(send.invocationId))!,
        "resume"
      );

      await expect
        .poll(() => hooksDriver.getEvents(send.invocationId), {
          timeout: 5_000,
          interval: 100,
        })
        .toEqual([
          // attempt 1: runs before-suspend, then suspends (inactivityTimeout: 100ms)
          // handler:error still fires
          "hook:handler:before",
          "hook:run:before-suspend:before",
          "hook:run:before-suspend:after",
          "hook:handler:error:[hw] (599) Suspended invocation",
          // attempt 2: replays before-suspend + awakeable, then executes after-resume
          "hook:handler:before",
          "hook:run:after-resume:before",
          "hook:run:after-resume:after",
          "hook:handler:after",
        ]);
      await waitForInvocationOutcome(getAdminUrl(), send.invocationId, {
        status: "succeeded",
      });
    });

    it("handler interceptor propagates async context to handler", async () => {
      const client = clients
        .connect({ url: getIngressUrl() })
        .serviceClient(asyncContextService);
      const { hookTag } = (await client.invoke("")) as {
        hookTag: string;
      };
      expect(hookTag).toBe("from-hook");
    });

    it("hooks provider receives correct request context for service", async () => {
      const client = clients
        .connect({ url: getIngressUrl() })
        .serviceClient(contextService);
      const { invocationId } = await client.invoke("");
      const req = await hooksDriver.getCapturedContext(invocationId);
      expect(req).toBeDefined();
      expect(req!.target.service).toBe(`${level}_Context`);
      expect(req!.target.handler).toBe("invoke");
      expect(req!.target.key).toBeUndefined();
      expect(req!.id).toBe(invocationId);
    });

    it("hooks provider receives correct request context with key for virtual object", async () => {
      const ingress = clients.connect({ url: getIngressUrl() });
      const client = ingress.objectClient(contextObj, "my-key");
      const { invocationId } = (await client.invoke("")) as {
        invocationId: string;
      };

      const req = await hooksDriver.getCapturedContext(invocationId);
      expect(req).toBeDefined();
      expect(req!.target.service).toBe(contextObjName);
      expect(req!.target.handler).toBe("invoke");
      expect(req!.target.key).toBe("my-key");
      expect(req!.id).toBe(invocationId);
    });

    it("input serde failure — terminal error", async () => {
      const client = clients
        .connect({ url: getIngressUrl() })
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
        .connect({ url: getIngressUrl() })
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
        .connect({ url: getIngressUrl() })
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
        .connect({ url: getIngressUrl() })
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
        .connect({ url: getIngressUrl() })
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
        .connect({ url: getIngressUrl() })
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
        .connect({ url: getIngressUrl() })
        .serviceClient(abortTimeoutService);
      const { invocationId } = await client.invoke("");
      const hookEvents = await hooksDriver.getEvents(invocationId);
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
      const ingress = clients.connect({ url: getIngressUrl() });
      const send = await ingress
        .serviceSendClient(cancelDuringRunService)
        .invoke("");

      await expect
        .poll(() => hooksDriver.getEvents(send.invocationId), {
          timeout: 5_000,
          interval: 100,
        })
        .toEqual(["hook:handler:before", "hook:run:slow-step:before"]);

      await cancelInvocationViaAdminApi(getAdminUrl(), send.invocationId);

      await expect
        .poll(() => hooksDriver.getEvents(send.invocationId), {
          timeout: 5_000,
          interval: 100,
        })
        .toEqual([
          "hook:handler:before",
          "hook:run:slow-step:before",
          "hook:handler:error:[hw] Cancelled",
          "hook:run:slow-step:error:[rw] Cancelled",
        ]);

      await waitForInvocationOutcome(getAdminUrl(), send.invocationId, {
        status: "failed",
      });
    });

    it("cancelled invocation — run interceptor waits for closure to complete", async () => {
      const ingress = clients.connect({ url: getIngressUrl() });
      const send = await ingress
        .serviceSendClient(cancelDuringSlowRunService)
        .invoke("");

      // Wait for the slow-step to be in-flight
      await delay(100);

      // Cancel — the slow-step closure is still sleeping (~1s).
      // Cancel sends a CancelledError through the VM protocol.
      await cancelInvocationViaAdminApi(getAdminUrl(), send.invocationId);

      // handler:error fires immediately (broken out by raceWithAttemptEnd).
      await expect
        .poll(() => hooksDriver.getEvents(send.invocationId), {
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
        .poll(() => hooksDriver.getEvents(send.invocationId), {
          timeout: 5_000,
          interval: 100,
        })
        .toEqual([
          "hook:handler:before",
          "hook:run:slow-step:before",
          "hook:handler:error:[hw] Cancelled",
          "hook:run:slow-step:after",
        ]);

      await waitForInvocationOutcome(getAdminUrl(), send.invocationId, {
        status: "failed",
      });
    });

    it("invocation pause requested in the middle of a run", async () => {
      const ingress = clients.connect({ url: getIngressUrl() });
      const send = await ingress
        .serviceSendClient(pauseDuringRunService)
        .invoke("");

      await expect
        .poll(() => hooksDriver.getEvents(send.invocationId), {
          timeout: 5_000,
          interval: 100,
        })
        .toEqual(["hook:handler:before", "hook:run:slow-step:before"]);

      await pauseInvocationViaAdminApi(getAdminUrl(), send.invocationId);

      await expect
        .poll(() => hooksDriver.getEvents(send.invocationId), {
          timeout: 10_000,
          interval: 100,
        })
        .toEqual([
          "hook:handler:before",
          "hook:run:slow-step:before",
          "hook:run:slow-step:after",
          "hook:handler:error:[hw] (599) Suspended invocation",
        ]);

      await waitForInvocationOutcome(
        getAdminUrl(),
        send.invocationId,
        {
          status: "paused",
        },
        {
          timeout: 10_000,
          interval: 100,
        }
      );
    });

    it("abort timeout before first command aborts the handler early", async () => {
      const ingress = clients.connect({ url: getIngressUrl() });
      const send = await ingress
        .serviceSendClient(abortBeforeFirstCommandService)
        .invoke("");

      // sdk-test-suite surfaces this abort as a suspended invocation after the
      // local run hook finishes, while the invocation itself still fails.
      await expect
        .poll(() => hooksDriver.getEvents(send.invocationId), {
          timeout: 10_000,
          interval: 100,
        })
        .toEqual([
          "hook:handler:before",
          "hook:run:after-wait:before",
          "hook:run:after-wait:after",
          "hook:handler:error:[hw] (599) Suspended invocation",
        ]);

      await waitForInvocationOutcome(
        getAdminUrl(),
        send.invocationId,
        {
          status: "failed",
        },
        {
          timeout: 10_000,
          interval: 100,
        }
      );
    });

    it("Always replay — suspend and replay after each entry", async () => {
      const client = clients
        .connect({ url: getIngressUrl() })
        .serviceClient(suspendPerEntryService);
      const { invocationId } = await client.invoke("");
      const hookEvents = await hooksDriver.getEvents(invocationId);
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
      const ingress = clients.connect({ url: getIngressUrl() });
      const send = await ingress
        .serviceSendClient(awakeableSuccessService)
        .invoke("");

      // Wait for the handler to create the awakeable
      await expect
        .poll(() => hooksDriver.getAwakeableId(send.invocationId), {
          timeout: 5_000,
          interval: 100,
        })
        .toBeTruthy();

      await ingress.resolveAwakeable(
        (await hooksDriver.getAwakeableId(send.invocationId))!,
        "hello"
      );

      await expect
        .poll(() => hooksDriver.getEvents(send.invocationId), {
          timeout: 5_000,
          interval: 100,
        })
        .toEqual(["hook:handler:before", "hook:handler:after"]);
    });

    it("awakeable reject via ingress — terminal error", async () => {
      const ingress = clients.connect({ url: getIngressUrl() });
      const send = await ingress
        .serviceSendClient(awakeableRejectService)
        .invoke("");

      // Wait for the handler to create the awakeable
      await expect
        .poll(() => hooksDriver.getAwakeableId(send.invocationId), {
          timeout: 5_000,
          interval: 100,
        })
        .toBeTruthy();

      await ingress.rejectAwakeable(
        (await hooksDriver.getAwakeableId(send.invocationId))!,
        "awakeable rejected"
      );

      await expect
        .poll(() => hooksDriver.getEvents(send.invocationId), {
          timeout: 5_000,
          interval: 100,
        })
        .toEqual([
          "hook:handler:before",
          "hook:handler:error:[hw] awakeable rejected",
        ]);

      await waitForInvocationOutcome(getAdminUrl(), send.invocationId, {
        status: "failed",
        journalOutput: {
          failure: {
            message: expect.stringContaining("awakeable rejected") as string,
          },
        },
      });
    });

    it("awakeable serde failure — retries then succeeds", async () => {
      const ingress = clients.connect({ url: getIngressUrl() });
      const send = await ingress
        .serviceSendClient(awakeableSerdeFailService)
        .invoke("");

      // Wait for the handler to create the awakeable (attempt 1)
      await expect
        .poll(() => hooksDriver.getAwakeableId(send.invocationId), {
          timeout: 5_000,
          interval: 100,
        })
        .toBeTruthy();

      // Resolve via ingress — serde will fail on deserialize (attempt 1)
      await ingress.resolveAwakeable(
        (await hooksDriver.getAwakeableId(send.invocationId))!,
        "hello"
      );

      // Attempt 1 fails, attempt 2 replays the awakeable with good serde
      await expect
        .poll(() => hooksDriver.getEvents(send.invocationId), {
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

      await waitForInvocationOutcome(getAdminUrl(), send.invocationId, {
        status: "succeeded",
        transientErrors: [
          { error_code: 500, error_message: "awakeable serde fail" },
        ],
      });
    });

    it("awakeable serde failure after prior run does not inherit stale run metadata", async () => {
      const ingress = clients.connect({ url: getIngressUrl() });
      const send = await ingress
        .serviceSendClient(awakeableSerdeFailAfterRunService)
        .invoke("");

      await expect
        .poll(() => hooksDriver.getAwakeableId(send.invocationId), {
          timeout: 5_000,
          interval: 100,
        })
        .toBeTruthy();

      await ingress.resolveAwakeable(
        (await hooksDriver.getAwakeableId(send.invocationId))!,
        "hello"
      );

      await expect
        .poll(() => hooksDriver.getEvents(send.invocationId), {
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

      await waitForInvocationOutcome(getAdminUrl(), send.invocationId, {
        status: "succeeded",
        transientErrors: [
          { error_code: 500, error_message: "awakeable serde fail" },
        ],
      });
    });
  });
}

hooksSuite("handler");
hooksSuite("service");

describe("default service hook overriding", { timeout: 120_000 }, () => {
  it("service hooks override default service hooks", async () => {
    const client = clients
      .connect({ url: getIngressUrl() })
      .serviceClient(overrideService);
    const { invocationId } = (await client.invoke("")) as {
      invocationId: string;
    };

    expect(await hooksDriver.getEvents(invocationId)).toEqual([
      "service:handler:before",
      "service:handler:after",
    ]);
  });
});

describe("hooks composition ordering", { timeout: 120_000 }, () => {
  it("service and handler hooks compose across retries", async () => {
    const client = clients
      .connect({ url: getIngressUrl() })
      .serviceClient(orderingService);
    const { invocationId } = (await client.invoke("")) as {
      invocationId: string;
    };

    expect(await hooksDriver.getEvents(invocationId)).toEqual([
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

describe("transient error command metadata", { timeout: 120_000 }, () => {
  it("transient errors carry correct command metadata per failure type", async () => {
    const ingress = clients.connect({ url: getIngressUrl() });
    const send = await ingress.serviceSendClient(kitchenSinkService).invoke("");

    const outcome = await waitForInvocationOutcome(
      getAdminUrl(),
      send.invocationId,
      {
        status: expect.stringMatching(/succeeded|failed/) as string,
      },
      {
        timeout: 30_000,
        interval: 200,
      }
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

describe("interceptor error isolation", { timeout: 120_000 }, () => {
  it("interceptors do not see SDK-internal metadata on caught errors", async () => {
    const client = clients
      .connect({ url: getIngressUrl() })
      .serviceClient(metadataLeakService);
    const { invocationId } = await client.invoke("");

    const leaks = await hooksDriver.getLeaks(invocationId);
    expect(leaks?.commandType ?? []).toHaveLength(0);
    expect(leaks?.commandIndex ?? []).toHaveLength(0);
  });

  it(
    "interceptor-thrown RetryableError does affect retry timing",
    { timeout: 5_000 },
    async () => {
      const client = clients
        .connect({ url: getIngressUrl() })
        .serviceClient(withCustomRetryAfterService);
      const { invocationId } = await client.invoke("");

      // overrideRetryAfterHook throws RetryableError with retryAfter: 120_000.
      // If the SDK honored it, the retry would wait 2 minutes and this test
      // would timeout (5s). With fastRetry (10ms interval), it completes fast.
      await waitForInvocationOutcome(getAdminUrl(), invocationId, {
        status: "succeeded",
      });
    }
  );
});
