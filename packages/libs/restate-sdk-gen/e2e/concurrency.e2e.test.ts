// Concurrency-primitive e2e: all, race, select, spawn, and mixed
// combinators (journal-backed + routine-backed in the same call) all
// behave correctly against a real Restate runtime.
//
// Both runtime modes are exercised so that replay-determinism (via
// alwaysReplay) catches any combinator-internal non-determinism.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import * as restate from "@restatedev/restate-sdk";
import * as clients from "@restatedev/restate-sdk-clients";
import { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import {
  gen,
  execute,
  spawn,
  run,
  all,
  race,
  select,
  type Operation,
} from "@restatedev/restate-sdk-gen";

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const concurrencySvc = restate.service({
  name: "concurrency",
  handlers: {
    // Two `run` in parallel; all waits for both, returns values in
    // input order.
    all: async (ctx: restate.Context): Promise<string> =>
      execute(
        ctx,
        gen(function* () {
          const a = run(
            async () => {
              await wait(40);
              return "alpha";
            },
            { name: "a" }
          );
          const b = run(
            async () => {
              await wait(20);
              return "bravo";
            },
            { name: "b" }
          );
          const [aVal, bVal] = yield* all([a, b]);
          return `${aVal}+${bVal}`;
        })
      ),

    // Race the fast and slow closures; the fast one wins.
    race: async (ctx: restate.Context): Promise<string> =>
      execute(
        ctx,
        gen(function* () {
          return yield* race([
            run(
              async () => {
                await wait(20);
                return "fast-result";
              },
              { name: "fast" }
            ),
            run(
              async () => {
                await wait(200);
                return "slow-result";
              },
              { name: "slow" }
            ),
          ]);
        })
      ),

    // select: race + tag. Switch on which branch fired.
    selectTagged: async (ctx: restate.Context): Promise<string> =>
      execute(
        ctx,
        gen(function* () {
          const r = yield* select({
            fast: run(
              async () => {
                await wait(20);
                return "F";
              },
              { name: "fast" }
            ),
            slow: run(
              async () => {
                await wait(200);
                return "S";
              },
              { name: "slow" }
            ),
          });
          switch (r.tag) {
            case "fast":
              return `fast-won:${yield* r.future}`;
            case "slow":
              return `slow-won:${yield* r.future}`;
          }
        })
      ),

    // Spawn two routines, all over their futures. Concurrency
    // starts at the spawn — by the time we await, the work is in flight.
    spawnPair: async (ctx: restate.Context): Promise<string> => {
      const child = (label: string, ms: number): Operation<string> =>
        gen(function* () {
          return yield* run(
            async () => {
              await wait(ms);
              return label;
            },
            { name: `${label}-step` }
          );
        });
      return execute(
        ctx,
        gen(function* () {
          const tA = yield* spawn(child("A", 40));
          const tB = yield* spawn(child("B", 20));
          const [a, b] = yield* all([tA, tB]);
          return `${a}|${b}`;
        })
      );
    },

    // Mixed sources: all over [journal-backed, routine-backed]
    // futures. The combinator handles both transparently.
    mixedAllOf: async (ctx: restate.Context): Promise<string> => {
      const child: Operation<string> = gen(function* () {
        return yield* run(
          async () => {
            await wait(20);
            return "from-spawn";
          },
          { name: "child-step" }
        );
      });
      return execute(
        ctx,
        gen(function* () {
          const journal = run(
            async () => {
              await wait(40);
              return "from-run";
            },
            { name: "journal-step" }
          );
          const routine = yield* spawn(child);
          const [a, b] = yield* all([journal, routine]);
          return `${a} + ${b}`;
        })
      );
    },
  },
});

const modes = [
  { name: "default", alwaysReplay: false },
  { name: "alwaysReplay", alwaysReplay: true },
] as const;

describe.each(modes)("concurrency — $name mode", ({ alwaysReplay }) => {
  let env: RestateTestEnvironment;
  let ingress: clients.Ingress;

  beforeAll(async () => {
    env = await RestateTestEnvironment.start({
      services: [concurrencySvc],
      alwaysReplay,
    });
    ingress = clients.connect({ url: env.baseUrl() });
  });

  afterAll(async () => {
    await env?.stop();
  });

  test("all returns both values in input order", async () => {
    const client = ingress.serviceClient(concurrencySvc);
    expect(await client.all()).toBe("alpha+bravo");
  });

  test("race returns the fast one", async () => {
    const client = ingress.serviceClient(concurrencySvc);
    expect(await client.race()).toBe("fast-result");
  });

  test("select returns the winning tag and the value via r.future", async () => {
    const client = ingress.serviceClient(concurrencySvc);
    expect(await client.selectTagged()).toBe("fast-won:F");
  });

  test("spawn pair: all over routine-backed futures", async () => {
    const client = ingress.serviceClient(concurrencySvc);
    expect(await client.spawnPair()).toBe("A|B");
  });

  test("mixed sources: run + spawn in one all", async () => {
    const client = ingress.serviceClient(concurrencySvc);
    expect(await client.mixedAllOf()).toBe("from-run + from-spawn");
  });
});
