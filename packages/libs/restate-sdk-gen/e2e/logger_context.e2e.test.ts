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

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type LoggerContextHandoffInput = {
  orderId: string;
  paymentId: string;
};

const loggerContextHandoff = restate.service({
  name: "loggerContextHandoff",
  handlers: {
    run: async (
      ctx: restate.Context,
      input: LoggerContextHandoffInput
    ): Promise<string> => {
      let log = ctx.console.child({ orderId: input.orderId });

      const payment = await ctx.run("payment", () => ({
        paymentId: input.paymentId,
      }));
      log = log.child({ paymentId: payment.paymentId });

      log.info("before-handoff");
      await ctx.sleep(2_000, "worker-handoff");
      log.info("after-handoff");

      return "done";
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

function captureLogger(
  worker: string,
  events: CapturedLogEvent[]
): restate.LoggerTransport {
  return (meta, message) => {
    if (message !== "before-handoff" && message !== "after-handoff") {
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

async function startLoggerContextWorker(
  port: number,
  logger: restate.LoggerTransport
): Promise<http2.Http2Server> {
  const handler = restate.createEndpointHandler({
    services: [loggerContextHandoff],
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

describe("logger context worker handoff", () => {
  test("rebuilds child logger context after worker restart", async () => {
    const events: CapturedLogEvent[] = [];
    let env: RestateTestEnvironment | undefined;
    let originalTracker: ReturnType<typeof trackHttp2Sessions> | undefined;
    let replacementWorker: http2.Http2Server | undefined;
    let replacementTracker: ReturnType<typeof trackHttp2Sessions> | undefined;

    try {
      env = await RestateTestEnvironment.start({
        services: [loggerContextHandoff],
        logger: captureLogger("worker-1", events),
      });
      originalTracker = trackHttp2Sessions(env.startedRestateHttpServer);
      const workerAddress =
        env.startedRestateHttpServer.address() as net.AddressInfo;
      const workerPort = workerAddress.port;
      const rs = sdkClients.connect({ url: env.baseUrl() });
      const client = rs.serviceClient(loggerContextHandoff);
      const input = {
        orderId: "order-worker-handoff",
        paymentId: "payment-worker-handoff",
      };

      const result = client.run(input);
      const worker1Before = await waitForLogEvent(
        events,
        (event) =>
          event.worker === "worker-1" &&
          event.message === "before-handoff" &&
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
          event.message === "before-handoff" &&
          event.replaying
      );
      const worker2After = await waitForLogEvent(
        events,
        (event) =>
          event.worker === "worker-2" &&
          event.message === "after-handoff" &&
          !event.replaying
      );

      expect(worker2Before.source).toBe("USER");
      expect(worker2Before.additionalContext).toStrictEqual(input);
      expect(worker2After.source).toBe("USER");
      expect(worker2After.additionalContext).toStrictEqual(input);
      expect(
        events.some(
          (event) =>
            event.worker === "worker-1" && event.message === "after-handoff"
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
