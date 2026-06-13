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

import { describe, expect, test } from "vitest";
import * as http2 from "node:http2";
import type * as net from "node:net";
import * as restate from "@restatedev/restate-sdk";
import * as sdkClients from "@restatedev/restate-sdk-clients";
import { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";

/**
 * Waits for asynchronous Restate processing to advance in polling-based tests.
 */
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type LoggerContextWorkerRestartInput = {
  orderId: string;
  paymentId: string;
};

const retryStepCount = 5;

type LoggerContextRetryInput = {
  workflowId: string;
};

type RetryContext = Record<string, string>;

const retryAttempts = new Map<string, number>();

const workerRestartMessages = new Set([
  "before-worker-restart",
  "after-worker-restart",
]);

/**
 * Records and returns the next attempt number for a retrying durable step.
 */
function bumpRetryAttempt(workflowId: string, step: number): number {
  const key = `${workflowId}:step-${step}`;
  const attempt = (retryAttempts.get(key) ?? 0) + 1;
  retryAttempts.set(key, attempt);
  return attempt;
}

const loggerContextWorkerRestart = restate.service({
  name: "loggerContextWorkerRestart",
  handlers: {
    run: async (
      ctx: restate.Context,
      input: LoggerContextWorkerRestartInput
    ): Promise<string> => {
      let log = ctx.console.child({ orderId: input.orderId });

      const payment = await ctx.run("payment", () => ({
        paymentId: input.paymentId,
      }));
      log = log.child({ paymentId: payment.paymentId });

      log.info("before-worker-restart");
      await ctx.sleep(2_000, "worker-restart");
      log.info("after-worker-restart");

      return "done";
    },
  },
});

const loggerContextRetry = restate.service({
  name: "loggerContextRetry",
  handlers: {
    run: async (
      ctx: restate.Context,
      input: LoggerContextRetryInput
    ): Promise<RetryContext> => {
      let log = ctx.console.child({ workflowId: input.workflowId });
      const context: RetryContext = { workflowId: input.workflowId };

      for (let step = 1; step <= retryStepCount; step++) {
        const fieldName = `step${step}`;
        const fieldValue = `value-${step}`;

        const result = await ctx.run(
          `step-${step}`,
          () => {
            const attempt = bumpRetryAttempt(input.workflowId, step);
            if (attempt === 1) {
              throw new Error(`step-${step} failed once`);
            }
            return { fieldName, fieldValue };
          },
          { maxRetryAttempts: 3, initialRetryInterval: 25 }
        );

        context[result.fieldName] = result.fieldValue;
        log = log.child({ [result.fieldName]: result.fieldValue });
        log.info(`after-step-${step}`);
      }

      return context;
    },
  },
});

type CapturedLogEvent = {
  worker: string;
  message: string;
  replaying: boolean;
  source: string;
  additionalContext: Record<string, string>;
};

/**
 * Creates a logger transport that captures selected user log messages together
 * with the worker label and copied logger context.
 *
 * By default it captures the worker restart service logs:
 * `before-worker-restart` is emitted by worker 1 immediately before the
 * invocation suspends on `ctx.sleep`, and `after-worker-restart` is emitted
 * after Restate resumes the same invocation on worker 2. Tests that assert
 * different log points pass their own message set.
 */
function captureLogger(
  worker: string,
  events: CapturedLogEvent[],
  capturedMessages = workerRestartMessages
): restate.LoggerTransport {
  return (meta, message) => {
    if (!capturedMessages.has(String(message))) {
      return;
    }

    events.push({
      worker,
      message: String(message),
      replaying: meta.replaying,
      source: String(meta.source),
      additionalContext: { ...(meta.context?.additionalContext ?? {}) },
    });
  };
}

/**
 * Polls until a captured log event matching the predicate is observed.
 */
async function waitForLogEvent(
  events: CapturedLogEvent[],
  predicate: (event: CapturedLogEvent) => boolean,
  timeoutMs = 10_000
): Promise<CapturedLogEvent> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const event = events.find(predicate);
    if (event) {
      return event;
    }
    await wait(25);
  }

  throw new Error(
    `Timed out waiting for log event. Events: ${JSON.stringify(events)}`
  );
}

/**
 * Tracks active HTTP/2 sessions so worker shutdown can force lingering sessions
 * closed when the server is intentionally restarted.
 */
function trackHttp2Sessions(server: http2.Http2Server): {
  destroySessions: () => void;
} {
  const sessions = new Set<http2.ServerHttp2Session>();
  server.on("session", (session) => {
    sessions.add(session);
    session.once("close", () => sessions.delete(session));
  });

  return {
    destroySessions() {
      for (const session of sessions) {
        if (!session.destroyed) {
          session.destroy();
        }
      }
    },
  };
}

/**
 * Closes an HTTP/2 server and optionally destroys tracked sessions if graceful
 * shutdown stalls.
 */
async function closeHttp2Server(
  server: http2.Http2Server,
  tracker?: { destroySessions: () => void }
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const forceClose = setTimeout(() => tracker?.destroySessions(), 250);
    server.close((error?: Error) => {
      clearTimeout(forceClose);
      if (
        error &&
        (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING"
      ) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

/**
 * Starts a replacement SDK worker on the same port as the original worker.
 */
async function startLoggerContextWorker(
  port: number,
  logger: restate.LoggerTransport
): Promise<http2.Http2Server> {
  const handler = restate.createEndpointHandler({
    services: [loggerContextWorkerRestart],
    logger,
  });
  const server = http2.createServer(handler);

  await new Promise<void>((resolve, reject) => {
    server
      .listen(port)
      .once("listening", () => resolve())
      .once("error", reject);
  });

  return server;
}

/**
 * Builds the expected accumulated retry logger context up to the requested step.
 */
function expectedRetryContext(upToStep = retryStepCount): RetryContext {
  const context: RetryContext = {
    workflowId: "retry-context-workflow",
  };

  for (let step = 1; step <= upToStep; step++) {
    context[`step${step}`] = `value-${step}`;
  }

  return context;
}

/**
 * Returns the retry test log messages that should be captured by the transport.
 */
function retryLogMessages(): Set<string> {
  return new Set(
    Array.from({ length: retryStepCount }, (_, index) => {
      return `after-step-${index + 1}`;
    })
  );
}

describe("logger context worker restart", () => {
  test("rebuilds child logger context after worker restart", async () => {
    const events: CapturedLogEvent[] = [];
    let env: RestateTestEnvironment | undefined;
    let originalTracker: ReturnType<typeof trackHttp2Sessions> | undefined;
    let replacementWorker: http2.Http2Server | undefined;
    let replacementTracker: ReturnType<typeof trackHttp2Sessions> | undefined;

    try {
      env = await RestateTestEnvironment.start({
        services: [loggerContextWorkerRestart],
        logger: captureLogger("worker-1", events),
      });
      originalTracker = trackHttp2Sessions(env.startedRestateHttpServer);
      const workerAddress =
        env.startedRestateHttpServer.address() as net.AddressInfo;
      const workerPort = workerAddress.port;
      const rs = sdkClients.connect({ url: env.baseUrl() });
      const client = rs.serviceClient(loggerContextWorkerRestart);
      const input = {
        orderId: "order-worker-restart",
        paymentId: "payment-worker-restart",
      };

      const result = client.run(input);
      const worker1Before = await waitForLogEvent(
        events,
        (event) =>
          event.worker === "worker-1" &&
          event.message === "before-worker-restart" &&
          !event.replaying
      );

      expect(worker1Before.source).toBe("USER");
      expect(worker1Before.additionalContext).toStrictEqual(input);

      await wait(150);
      await closeHttp2Server(env.startedRestateHttpServer, originalTracker);

      replacementWorker = await startLoggerContextWorker(
        workerPort,
        captureLogger("worker-2", events)
      );
      replacementTracker = trackHttp2Sessions(replacementWorker);

      await expect(result).resolves.toBe("done");

      const worker2Before = await waitForLogEvent(
        events,
        (event) =>
          event.worker === "worker-2" &&
          event.message === "before-worker-restart" &&
          event.replaying
      );
      const worker2After = await waitForLogEvent(
        events,
        (event) =>
          event.worker === "worker-2" &&
          event.message === "after-worker-restart" &&
          !event.replaying
      );

      expect(worker2Before.source).toBe("USER");
      expect(worker2Before.additionalContext).toStrictEqual(input);
      expect(worker2After.source).toBe("USER");
      expect(worker2After.additionalContext).toStrictEqual(input);
      expect(
        events.some(
          (event) =>
            event.worker === "worker-1" &&
            event.message === "after-worker-restart"
        )
      ).toBe(false);
    } finally {
      if (replacementWorker) {
        await closeHttp2Server(replacementWorker, replacementTracker);
      }
      if (env) {
        await closeHttp2Server(env.startedRestateHttpServer, originalTracker);
        await env.startedRestateContainer.stop();
      }
    }
  }, 30_000);
});

describe("logger context retry recovery", () => {
  test("emits each visible log once and keeps accumulated context after retries", async () => {
    retryAttempts.clear();
    const events: CapturedLogEvent[] = [];
    let env: RestateTestEnvironment | undefined;

    try {
      env = await RestateTestEnvironment.start({
        services: [loggerContextRetry],
        logger: captureLogger("worker", events, retryLogMessages()),
        alwaysReplay: true,
      });
      const rs = sdkClients.connect({ url: env.baseUrl() });
      const client = rs.serviceClient(loggerContextRetry);

      await expect(
        client.run({ workflowId: "retry-context-workflow" })
      ).resolves.toStrictEqual(expectedRetryContext());

      for (let step = 1; step <= retryStepCount; step++) {
        expect(retryAttempts.get(`retry-context-workflow:step-${step}`)).toBe(
          2
        );
      }

      const visibleUserLogs = events.filter((event) => {
        return event.source === "USER" && !event.replaying;
      });

      expect(visibleUserLogs.map((event) => event.message)).toStrictEqual([
        "after-step-1",
        "after-step-2",
        "after-step-3",
        "after-step-4",
        "after-step-5",
      ]);

      for (let step = 1; step <= retryStepCount; step++) {
        expect(visibleUserLogs[step - 1]?.additionalContext).toStrictEqual(
          expectedRetryContext(step)
        );
      }
    } finally {
      retryAttempts.clear();
      await env?.stop();
    }
  }, 30_000);
});
