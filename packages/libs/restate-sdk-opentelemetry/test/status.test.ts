/*
 * Copyright (c) 2023-2026 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { TerminalError, type Request } from "@restatedev/restate-sdk";
import { openTelemetryHook } from "../src/index.js";

beforeAll(() => {
  context.setGlobalContextManager(
    new AsyncLocalStorageContextManager().enable()
  );
});

afterAll(() => {
  context.disable();
});

const request: Request = {
  id: "test-invocation" as Request["id"],
  target: {
    service: "Example",
    handler: "handle",
    toString: () => "Example/handle",
  },
  headers: new Map(),
  attemptHeaders: new Map(),
  body: new Uint8Array(),
  extraArgs: [],
  attemptCompletedSignal: new AbortController().signal,
};

describe.each(["attempt", "run"] as const)("%s span status", (lifecycle) => {
  let exporter: InMemorySpanExporter;
  let provider: BasicTracerProvider;

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
  });

  afterEach(async () => {
    await provider.shutdown();
  });

  async function execute(
    next: () => Promise<void>,
    suppressSpanEventsDuringReplay = true,
    isProcessing = () => true
  ) {
    const hooks = openTelemetryHook({
      tracer: provider.getTracer("status-test"),
      suppressSpanEventsDuringReplay,
    })({
      request,
      // The SDK supplies this hidden callback to distinguish replayed work.
      [Symbol.for("@restatedev/restate-sdk/hooks.isProcessing")]: isProcessing,
    });
    await hooks.interceptor!.handler!(async () => {
      if (lifecycle === "run") {
        await hooks.interceptor!.run!("work", next);
      } else {
        await next();
      }
    });
    await provider.forceFlush();
  }

  function finishedSpan() {
    const name = lifecycle === "run" ? "run (work)" : "attempt Example/handle";
    const span = exporter.getFinishedSpans().find((span) => span.name === name);
    expect(span).toBeDefined();
    return span!;
  }

  it("leaves healthy completion unset", async () => {
    await execute(async () => {
      // Verify the active context survives asynchronous work.
      await Promise.resolve();
      expect(trace.getActiveSpan()).toBeDefined();
    });
    expect(finishedSpan().status).toEqual({ code: SpanStatusCode.UNSET });
    expect(finishedSpan().events).toEqual([]);
  });

  it.each([true, false])(
    "preserves a caught application error (replay suppression: %s)",
    async (suppressSpanEventsDuringReplay) => {
      await execute(async () => {
        await Promise.resolve();
        try {
          throw new Error("operation failed");
        } catch (error) {
          const span = trace.getActiveSpan()!;
          span.recordException(error as Error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: "fallback used",
          });
        }
        // The application handled the error and completes normally.
      }, suppressSpanEventsDuringReplay);

      expect(finishedSpan().status).toEqual({
        code: SpanStatusCode.ERROR,
        message: "fallback used",
      });
      expect(finishedSpan().events).toMatchObject([
        {
          name: "exception",
          attributes: { "exception.message": "operation failed" },
        },
      ]);
    }
  );

  it("preserves application-supplied OK", async () => {
    await execute(async () => {
      trace.getActiveSpan()!.setStatus({ code: SpanStatusCode.OK });
    });
    expect(finishedSpan().status).toEqual({ code: SpanStatusCode.OK });
  });

  it("does not infer an error status from an exception event alone", async () => {
    await execute(async () => {
      trace.getActiveSpan()!.recordException(new Error("handled error"));
    });
    expect(finishedSpan().status).toEqual({ code: SpanStatusCode.UNSET });
    expect(finishedSpan().events).toMatchObject([{ name: "exception" }]);
  });

  it("records thrown failures and rethrows the original error", async () => {
    const error = new Error("unhandled failure");
    await expect(
      execute(async () => {
        throw error;
      })
    ).rejects.toBe(error);
    expect(finishedSpan().status).toEqual({
      code: SpanStatusCode.ERROR,
      message: error.message,
    });
    expect(finishedSpan().events).toMatchObject([
      {
        name: "exception",
        attributes: { "exception.message": error.message },
      },
    ]);
  });

  it("ends suspended spans without recording a failure", async () => {
    // 599 is the SDK's internal attempt-suspension signal.
    const suspended = new TerminalError("suspended", { errorCode: 599 });
    await expect(
      execute(async () => {
        throw suspended;
      })
    ).rejects.toBe(suspended);
    expect(finishedSpan().status).toEqual({ code: SpanStatusCode.UNSET });
    expect(finishedSpan().events).toEqual([]);
  });

  if (lifecycle === "attempt") {
    it("preserves status while suppressing replayed events", async () => {
      let processing = false;
      await execute(
        async () => {
          const span = trace.getActiveSpan()!;
          span.recordException(new Error("replayed error"));
          span.addEvent("replayed event");
          span.setStatus({ code: SpanStatusCode.ERROR, message: "fallback" });
          processing = true;
          span.addEvent("fresh event");
        },
        true,
        () => processing
      );
      expect(finishedSpan().status).toEqual({
        code: SpanStatusCode.ERROR,
        message: "fallback",
      });
      expect(finishedSpan().events).toMatchObject([{ name: "fresh event" }]);
      expect(finishedSpan().events).toHaveLength(1);
    });
  }
});
