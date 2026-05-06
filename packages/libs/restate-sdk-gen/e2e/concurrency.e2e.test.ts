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

// Concurrency-primitive e2e: all, race, select, spawn, and mixed
// combinators (journal-backed + routine-backed in the same call) all
// behave correctly against a real Restate runtime.
//
// Both runtime modes are exercised so that replay-determinism (via
// alwaysReplay) catches any combinator-internal non-determinism.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import {
  service,
  spawn,
  run,
  all,
  race,
  select,
  type Operation,
  clients,
} from "@restatedev/restate-sdk-gen";

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const concurrencySvc = service({
  name: "concurrency",
  handlers: {
    // Two `run` in parallel; all waits for both, returns values in
    // input order.
    *all(): Operation<string> {
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
    },

    // Race the fast and slow closures; the fast one wins.
    *race(): Operation<string> {
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
    },

    // select: race + tag. Switch on which branch fired.
    *selectTagged(): Operation<string> {
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
    },

    // Spawn two routines, all over their futures. Concurrency
    // starts at the spawn — by the time we await, the work is in flight.
    *spawnPair(): Operation<string> {
      const child = (label: string, ms: number): Operation<string> =>
        (function* () {
          return yield* run(
            async () => {
              await wait(ms);
              return label;
            },
            { name: `${label}-step` }
          );
        })();
      const tA = yield* spawn(child("A", 40));
      const tB = yield* spawn(child("B", 20));
      const [a, b] = yield* all([tA, tB]);
      return `${a}|${b}`;
    },

    // Mixed sources: all over [journal-backed, routine-backed]
    // futures. The combinator handles both transparently.
    *mixedAllOf(): Operation<string> {
      const child: Operation<string> = (function* () {
        return yield* run(
          async () => {
            await wait(20);
            return "from-spawn";
          },
          { name: "child-step" }
        );
      })();
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
    const client = clients.client(ingress, concurrencySvc);
    expect(await client.all()).toBe("alpha+bravo");
  });

  test("race returns the fast one", async () => {
    const client = clients.client(ingress, concurrencySvc);
    expect(await client.race()).toBe("fast-result");
  });

  test("select returns the winning tag and the value via r.future", async () => {
    const client = clients.client(ingress, concurrencySvc);
    expect(await client.selectTagged()).toBe("fast-won:F");
  });

  test("spawn pair: all over routine-backed futures", async () => {
    const client = clients.client(ingress, concurrencySvc);
    expect(await client.spawnPair()).toBe("A|B");
  });

  test("mixed sources: run + spawn in one all", async () => {
    const client = clients.client(ingress, concurrencySvc);
    expect(await client.mixedAllOf()).toBe("from-run + from-spawn");
  });
});
