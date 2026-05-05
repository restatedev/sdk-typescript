// Terminal-error e2e: TerminalError thrown by handler code surfaces
// verbatim and triggers no retries.
//
// Two flavors:
//   insideRun  — throw from inside an ops.run closure. The SDK journals
//                it as a terminal failure; yield* re-throws to the
//                workflow body, which propagates.
//   outsideRun — throw straight from the gen body, no ops.run involved.
//
// Tested in both runtime modes:
//   default       — normal bidi stream
//   alwaysReplay  — every suspension point forces a journal replay,
//                   surfacing non-determinism if the workflow has any.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import * as restate from "@restatedev/restate-sdk";
import * as clients from "@restatedev/restate-sdk-clients";
import { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { gen, execute, run } from "@restatedev/restate-sdk-gen";

// Module-scope counters: handlers record how many times their throwing
// code path executed. Cleared per-test inside describe.each blocks.
const attempts = new Map<string, number>();
const bump = (key: string): number => {
  const n = (attempts.get(key) ?? 0) + 1;
  attempts.set(key, n);
  return n;
};

const terminalSvc = restate.service({
  name: "terminal",
  handlers: {
    insideRun: async (ctx: restate.Context, key: string): Promise<string> =>
      execute(
        ctx,
        gen(function* () {
          return yield* run(
            async () => {
              bump(key);
              throw new restate.TerminalError("inside-run-fatal");
            },
            { name: "step" }
          );
        })
      ),

    outsideRun: async (ctx: restate.Context, key: string): Promise<string> =>
      execute(
        ctx,
        gen(function* () {
          bump(key);
          throw new restate.TerminalError("outside-run-fatal");
          // unreachable; keeps the generator's return type happy
          yield* run(async () => "x", { name: "never" });
        })
      ),
  },
});

const modes = [
  { name: "default", alwaysReplay: false },
  { name: "alwaysReplay", alwaysReplay: true },
] as const;

describe.each(modes)("terminal errors — $name mode", ({ alwaysReplay }) => {
  let env: RestateTestEnvironment;
  let ingress: clients.Ingress;

  beforeAll(async () => {
    env = await RestateTestEnvironment.start({
      services: [terminalSvc],
      // Terminal errors don't trigger retries, so disabling retries
      // costs nothing here and keeps the test fast.
      disableRetries: true,
      alwaysReplay,
    });
    ingress = clients.connect({ url: env.baseUrl() });
  });

  afterAll(async () => {
    await env?.stop();
  });

  test("inside ops.run", async () => {
    attempts.clear();
    const key = `inside-${alwaysReplay ? "replay" : "default"}`;
    const client = ingress.serviceClient(terminalSvc);
    await expect(client.insideRun(key)).rejects.toThrow(/inside-run-fatal/);
    // Closure ran exactly once — terminal errors don't retry, and the
    // journaled terminal outcome is replayed (not re-executed) under
    // alwaysReplay too.
    expect(attempts.get(key)).toBe(1);
  });

  test("outside ops.run (raw throw in the gen body)", async () => {
    attempts.clear();
    const key = `outside-${alwaysReplay ? "replay" : "default"}`;
    const client = ingress.serviceClient(terminalSvc);
    await expect(client.outsideRun(key)).rejects.toThrow(/outside-run-fatal/);
    // No journal entries before the throw → no suspension → no replay
    // even in alwaysReplay mode. Body runs exactly once.
    expect(attempts.get(key)).toBe(1);
  });
});
