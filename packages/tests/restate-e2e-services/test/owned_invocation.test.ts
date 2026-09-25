// Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
//
// This file is part of the Restate e2e tests,
// which are released under the MIT license.
//
// You can find a copy of the license in file LICENSE in the root
// directory of this repository or package, or at
// https://github.com/restatedev/e2e/blob/main/LICENSE

import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { waitForInvocationOutcome } from "./hooks_utils.js";
import { withOwnedInvocation } from "./owned_invocation.js";

// These tests use a local HTTP fixture that imitates the Restate admin API, not a
// Restate server. They pin the bounds of the helpers used by the #672 combinator
// tests: a stalled admin API must make the outcome helper fail within its budget,
// every request it started must be aborted, and invocation cleanup must still run
// and keep the original failure.

type RequestKind = "outcome" | "events" | "attempts" | "kill" | "other";
type Behavior = "respond" | "stall-headers" | "stall-body";

interface AdminFixture {
  url: string;
  requests: RequestKind[];
  openRequests(): number;
  close(): Promise<void>;
}

function classify(req: IncomingMessage, body: string): RequestKind {
  if (req.method === "PATCH" && req.url?.endsWith("/kill")) return "kill";
  if (req.url !== "/query") return "other";
  if (body.includes("sys_journal_events")) return "events";
  if (body.includes("completion_result")) return "outcome";
  if (body.includes("retry_count")) return "attempts";
  return "other";
}

async function startAdminFixture(
  behavior: (kind: RequestKind) => Behavior
): Promise<AdminFixture> {
  const requests: RequestKind[] = [];
  const open = new Set<ServerResponse>();
  const sockets = new Set<Socket>();
  let killed = false;
  let closed: Promise<void> | undefined;

  const server = createServer((req, res) => {
    open.add(res);
    res.on("close", () => open.delete(res));
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => (body += chunk));
    req.on("end", () => {
      const kind = classify(req, body);
      requests.push(kind);
      const mode = behavior(kind);
      if (mode === "stall-headers") return;
      res.writeHead(200, { "content-type": "application/json" });
      if (mode === "stall-body") {
        res.write('{"rows":');
        return;
      }
      if (kind === "kill") {
        killed = true;
        res.end("{}");
        return;
      }
      let rows: unknown[] = [];
      if (kind === "outcome") {
        rows = [
          {
            status: "completed",
            completion_result: "failure",
            completion_failure: "[500] fixture failure",
            entry_json: null,
          },
        ];
      } else if (kind === "attempts") {
        rows = [
          {
            status: killed ? "completed" : "backing-off",
            retry_count: 3,
            last_failure: "fixture failure",
          },
        ];
      }
      res.end(JSON.stringify({ rows }));
    });
  });
  server.on("connection", (socket: Socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("admin fixture has no port");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    openRequests: () => open.size,
    close: () =>
      (closed ??= new Promise<void>((resolve) => {
        for (const res of open) res.destroy();
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      })),
  };
}

/**
 * Runs `test` against a fixture. The hard stop tears the fixture down if the code
 * under test never settles by itself, so a regression fails the timing assertions
 * instead of hanging the run.
 */
async function withFixture(
  behavior: (kind: RequestKind) => Behavior,
  hardStopMs: number,
  test: (fixture: AdminFixture) => Promise<void>
): Promise<void> {
  const fixture = await startAdminFixture(behavior);
  const hardStop = setTimeout(() => void fixture.close(), hardStopMs);
  try {
    await test(fixture);
  } finally {
    clearTimeout(hardStop);
    await fixture.close();
  }
}

async function expectNoOpenRequests(fixture: AdminFixture): Promise<void> {
  // Aborted requests close their connection asynchronously; allow a moment.
  await vi.waitFor(() => expect(fixture.openRequests()).toBe(0), {
    timeout: 1_000,
    interval: 10,
  });
}

const STALL_POINTS = [
  { name: "invocation query headers", kind: "outcome", mode: "stall-headers" },
  { name: "invocation query body", kind: "outcome", mode: "stall-body" },
  {
    name: "transient-error query headers",
    kind: "events",
    mode: "stall-headers",
  },
  { name: "transient-error query body", kind: "events", mode: "stall-body" },
] as const;

// Small bounds keep the fixture tests fast. The outcome helper must settle within
// about timeout + requestTimeout; the slack only absorbs scheduling on a loaded machine.
const POLL = { timeout: 300, interval: 20, requestTimeout: 200 };
const SLACK_MS = 1_500;
const OUTCOME_BOUND_MS = POLL.timeout + POLL.requestTimeout + SLACK_MS;
const CLEANUP_TIMEOUT_MS = 1_000;
const HARD_STOP_MS = OUTCOME_BOUND_MS + CLEANUP_TIMEOUT_MS + 3_000;
const TEST_TIMEOUT_MS = HARD_STOP_MS + 5_000;
const INVOCATION_ID = "inv_fixture";

describe("waitForInvocationOutcome against a stalled admin API", () => {
  it.each(STALL_POINTS)(
    "rejects within its bound and aborts its requests when the $name stall",
    async ({ kind, mode }) => {
      await withFixture(
        (k) => (k === kind ? mode : "respond"),
        HARD_STOP_MS,
        async (fixture) => {
          const started = Date.now();
          await expect(
            waitForInvocationOutcome(
              fixture.url,
              INVOCATION_ID,
              { status: "failed" },
              POLL
            )
          ).rejects.toThrow("Matcher did not succeed in time");
          expect(Date.now() - started).toBeLessThan(OUTCOME_BOUND_MS);
          expect(fixture.requests).toContain(kind);
          await expectNoOpenRequests(fixture);
        }
      );
    },
    TEST_TIMEOUT_MS
  );
});

describe("withOwnedInvocation when the outcome query stalls", () => {
  it.each(STALL_POINTS)(
    "ends the invocation and rethrows the original failure when the $name stall",
    async ({ kind, mode }) => {
      // Only the outcome queries stall; status reads and kill answer, so admin
      // access has recovered by the time cleanup runs.
      await withFixture(
        (k) => (k === kind ? mode : "respond"),
        HARD_STOP_MS,
        async (fixture) => {
          let original: unknown;
          const started = Date.now();
          const failure = await withOwnedInvocation(
            fixture.url,
            INVOCATION_ID,
            async () => {
              try {
                await waitForInvocationOutcome(
                  fixture.url,
                  INVOCATION_ID,
                  { status: "failed" },
                  POLL
                );
              } catch (e) {
                original = e;
                throw e;
              }
            },
            { cleanupTimeoutMs: CLEANUP_TIMEOUT_MS }
          ).then(
            () => undefined,
            (e: unknown) => e
          );

          expect(Date.now() - started).toBeLessThan(
            OUTCOME_BOUND_MS + CLEANUP_TIMEOUT_MS
          );
          expect(original).toBeInstanceOf(Error);
          expect(failure).toBe(original);
          expect((failure as Error).message).toContain(
            "Matcher did not succeed in time"
          );
          expect((failure as Error).message).not.toContain("cleanup");
          // Cleanup ran after the stalled query: status read, kill, then a read
          // back of the completed state.
          const firstCleanup = fixture.requests.indexOf("attempts");
          expect(firstCleanup).toBeGreaterThan(fixture.requests.indexOf(kind));
          expect(fixture.requests.slice(firstCleanup)).toEqual([
            "attempts",
            "kill",
            "attempts",
          ]);
          await expectNoOpenRequests(fixture);
        }
      );
    },
    TEST_TIMEOUT_MS
  );

  it(
    "keeps the original failure and reports cleanup as unverified when the admin API stays unavailable",
    async () => {
      await withFixture(
        () => "stall-headers",
        HARD_STOP_MS,
        async (fixture) => {
          let original: unknown;
          const started = Date.now();
          const failure = await withOwnedInvocation(
            fixture.url,
            INVOCATION_ID,
            async () => {
              try {
                await waitForInvocationOutcome(
                  fixture.url,
                  INVOCATION_ID,
                  { status: "failed" },
                  POLL
                );
              } catch (e) {
                original = e;
                throw e;
              }
            },
            { cleanupTimeoutMs: CLEANUP_TIMEOUT_MS }
          ).then(
            () => undefined,
            (e: unknown) => e
          );

          expect(Date.now() - started).toBeLessThan(
            OUTCOME_BOUND_MS + CLEANUP_TIMEOUT_MS
          );
          expect(original).toBeInstanceOf(Error);
          expect(failure).toBe(original);
          const message = (failure as Error).message;
          expect(message).toContain("Matcher did not succeed in time");
          expect(message).toContain(
            `could not verify that invocation ${INVOCATION_ID} ended within ${CLEANUP_TIMEOUT_MS} ms`
          );
          expect(message).toContain("the invocation may still be running");
          // Cleanup was entered but never saw a state to act on.
          expect(fixture.requests).toContain("attempts");
          expect(fixture.requests).not.toContain("kill");
          await expectNoOpenRequests(fixture);
        }
      );
    },
    TEST_TIMEOUT_MS
  );
});
