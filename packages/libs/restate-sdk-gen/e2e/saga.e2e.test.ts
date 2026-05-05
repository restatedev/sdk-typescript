// Saga-style compensation e2e: a 3-step workflow (reserve, charge,
// create) with a try/catch that runs a journaled compensation step
// (release the reservation) when any later step fails.
//
// Each handler exercises a different failure point so we can verify:
//   - success path runs all three steps without compensation
//   - failure in `charge` runs the release compensation
//   - failure in `create` also runs the release compensation
//
// `released` (module-scope counter) records how many times the
// compensation step ran, so we can assert it actually fired.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import * as restate from "@restatedev/restate-sdk";
import * as clients from "@restatedev/restate-sdk-clients";
import { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { gen, execute, run } from "@restatedev/restate-sdk-gen";

const released = new Map<string, number>();
const released_bump = (key: string): void => {
  released.set(key, (released.get(key) ?? 0) + 1);
};

type Step = "reserve" | "charge" | "create";
type SagaReq = { key: string; failAt?: Step };

const sagaSvc = restate.service({
  name: "saga",
  handlers: {
    placeOrder: async (
      ctx: restate.Context,
      req: SagaReq
    ): Promise<{ orderId: string }> =>
      execute(
        ctx,
        gen(function* () {
          const reservation = yield* run(
            async () => {
              if (req.failAt === "reserve") {
                throw new restate.TerminalError("reserve failed");
              }
              return { id: `res-${req.key}` };
            },
            { name: "reserve" }
          );

          try {
            const charge = yield* run(
              async () => {
                if (req.failAt === "charge") {
                  throw new restate.TerminalError("charge failed");
                }
                return { id: `chg-${req.key}` };
              },
              { name: "charge" }
            );

            const orderId = yield* run(
              async () => {
                if (req.failAt === "create") {
                  throw new restate.TerminalError("create failed");
                }
                return `order-${reservation.id}-${charge.id}`;
              },
              { name: "create-order" }
            );

            return { orderId };
          } catch (e) {
            // Compensation: release the reservation. The release itself
            // is journaled so it survives a crash mid-compensation.
            yield* run(
              async () => {
                released_bump(req.key);
              },
              { name: "release" }
            );
            throw e;
          }
        })
      ),
  },
});

const modes = [
  { name: "default", alwaysReplay: false },
  { name: "alwaysReplay", alwaysReplay: true },
] as const;

describe.each(modes)("saga compensation — $name mode", ({ alwaysReplay }) => {
  let env: RestateTestEnvironment;
  let ingress: clients.Ingress;

  beforeAll(async () => {
    env = await RestateTestEnvironment.start({
      services: [sagaSvc],
      // Saga steps throw TerminalError on failure paths — no retries
      // expected in any case.
      disableRetries: true,
      alwaysReplay,
    });
    ingress = clients.connect({ url: env.baseUrl() });
  });

  afterAll(async () => {
    await env?.stop();
  });

  test("success: all three steps run, no compensation", async () => {
    released.clear();
    const key = `ok-${alwaysReplay ? "replay" : "default"}`;
    const client = ingress.serviceClient(sagaSvc);
    const out = await client.placeOrder({ key });
    expect(out.orderId).toBe(`order-res-${key}-chg-${key}`);
    // Compensation never ran.
    expect(released.has(key)).toBe(false);
  });

  test("charge fails: release compensation runs, original error surfaces", async () => {
    released.clear();
    const key = `charge-${alwaysReplay ? "replay" : "default"}`;
    const client = ingress.serviceClient(sagaSvc);
    await expect(client.placeOrder({ key, failAt: "charge" })).rejects.toThrow(
      /charge failed/
    );
    // Release ran exactly once (journaled, replay-safe).
    expect(released.get(key)).toBe(1);
  });

  test("create fails: release compensation runs, original error surfaces", async () => {
    released.clear();
    const key = `create-${alwaysReplay ? "replay" : "default"}`;
    const client = ingress.serviceClient(sagaSvc);
    await expect(client.placeOrder({ key, failAt: "create" })).rejects.toThrow(
      /create failed/
    );
    expect(released.get(key)).toBe(1);
  });

  test("reserve fails: no compensation needed (nothing to undo)", async () => {
    released.clear();
    const key = `reserve-${alwaysReplay ? "replay" : "default"}`;
    const client = ingress.serviceClient(sagaSvc);
    await expect(client.placeOrder({ key, failAt: "reserve" })).rejects.toThrow(
      /reserve failed/
    );
    // Reservation never succeeded → catch wasn't entered → release
    // never ran.
    expect(released.has(key)).toBe(false);
  });
});
