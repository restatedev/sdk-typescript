// Transient-error e2e: non-terminal errors trigger SDK retries; the
// handler eventually succeeds when the underlying condition clears.
//
// Three flavors:
//   insideRun     — closure throws regular Error twice, succeeds on
//                   attempt 3. SDK retries the closure with backoff.
//   outsideRun    — handler body throws twice, succeeds on attempt 3.
//                   SDK retries the *whole* handler invocation; journaled
//                   ops.run entries from prior attempts replay if any.
//   boundedRetry  — closure fails forever; maxRetryAttempts: 2 means the
//                   SDK gives up and surfaces a TerminalError.
//
// Both runtime modes: default + alwaysReplay (forces replay after every
// journal entry).

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import * as restate from "@restatedev/restate-sdk";
import * as clients from "@restatedev/restate-sdk-clients";
import { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { gen, execute, run } from "@restatedev/restate-sdk-gen";

const attempts = new Map<string, number>();
const bump = (key: string): number => {
  const n = (attempts.get(key) ?? 0) + 1;
  attempts.set(key, n);
  return n;
};

const transientSvc = restate.service({
  name: "transient",
  handlers: {
    // Closure fails twice, succeeds on attempt 3. Bounded with
    // maxRetryAttempts so a regression (closure permanently failing)
    // surfaces as a TerminalError instead of hanging.
    insideRun: async (ctx: restate.Context, key: string): Promise<string> =>
      execute(
        ctx,
        gen(function* () {
          return yield* run(
            async () => {
              const n = bump(key);
              if (n < 3) throw new Error(`attempt ${n} failed`);
              return `ok-after-${n}`;
            },
            {
              name: "flaky",
              retry: { maxAttempts: 5, initialInterval: { milliseconds: 50 } },
            }
          );
        })
      ),

    // Handler body throws before reaching `run`. SDK retries the whole
    // handler — every retry is a fresh gen body invocation (with
    // journal replay for any committed entries).
    outsideRun: async (ctx: restate.Context, key: string): Promise<string> =>
      execute(
        ctx,
        gen(function* () {
          const n = bump(key);
          if (n < 3) throw new Error(`handler attempt ${n} failed`);
          return yield* run(async () => `ok-after-${n}`, {
            name: "after-recovery",
          });
        })
      ),

    // Closure that never recovers. With maxRetryAttempts: 2, the SDK
    // makes 2 attempts then gives up with a TerminalError.
    boundedRetry: async (ctx: restate.Context, key: string): Promise<string> =>
      execute(
        ctx,
        gen(function* () {
          return yield* run(
            async () => {
              const n = bump(key);
              throw new Error(`doomed attempt ${n}`);
            },
            {
              name: "doomed",
              retry: { maxAttempts: 2, initialInterval: { milliseconds: 25 } },
            }
          );
        })
      ),
  },
});

const modes = [
  { name: "default", alwaysReplay: false },
  { name: "alwaysReplay", alwaysReplay: true },
] as const;

describe.each(modes)("transient errors — $name mode", ({ alwaysReplay }) => {
  let env: RestateTestEnvironment;
  let ingress: clients.Ingress;

  beforeAll(async () => {
    env = await RestateTestEnvironment.start({
      services: [transientSvc],
      // Retries must be enabled — that's the whole point.
      alwaysReplay,
    });
    ingress = clients.connect({ url: env.baseUrl() });
  });

  afterAll(async () => {
    await env?.stop();
  });

  test("inside ops.run: closure retries, eventually returns", async () => {
    attempts.clear();
    const key = `inside-${alwaysReplay ? "replay" : "default"}`;
    const client = ingress.serviceClient(transientSvc);
    expect(await client.insideRun(key)).toBe("ok-after-3");
    // Closure ran exactly 3 times — once-success is journaled and not
    // re-run on subsequent replays.
    expect(attempts.get(key)).toBe(3);
  });

  test("outside ops.run: whole handler retries, eventually returns", async () => {
    attempts.clear();
    const key = `outside-${alwaysReplay ? "replay" : "default"}`;
    const client = ingress.serviceClient(transientSvc);
    expect(await client.outsideRun(key)).toBe("ok-after-3");
    // The body's bump() is non-journaled state. In default mode it
    // runs once per retry up to success → exactly 3. In alwaysReplay
    // mode every journal entry forces an additional replay, and bump
    // runs again at the top of the gen body each time. So the count
    // is 3 in default mode, more under alwaysReplay — assert ">= 3".
    expect(attempts.get(key)).toBeGreaterThanOrEqual(3);
  });

  test("bounded retry: maxRetryAttempts hit → TerminalError", async () => {
    attempts.clear();
    const key = `bounded-${alwaysReplay ? "replay" : "default"}`;
    const client = ingress.serviceClient(transientSvc);
    await expect(client.boundedRetry(key)).rejects.toThrow(/doomed/);
    // 2 attempts before the SDK gives up.
    expect(attempts.get(key)).toBe(2);
  });
});
