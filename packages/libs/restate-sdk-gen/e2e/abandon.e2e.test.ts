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

// Abandon-on-main-exit e2e: under the default `onMainExit: "abandon"`,
// the handler returns as soon as the main routine settles — spawned
// routines (and race losers) still parked on never-settling sources
// are abandoned instead of hanging the handler.
//
// Both runtime modes are exercised. alwaysReplay is the important one:
// it proves the abandon stop-point is replay-deterministic — the
// journal commands created by a mid-flight, multi-step routine before
// it was abandoned replay to the exact same prefix (per-tick race
// winners are journaled combinator entries, so the scheduler walks the
// same trajectory and stops at the same point).

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import {
  service,
  spawn,
  run,
  race,
  sleep,
  type Operation,
  clients,
} from "@restatedev/restate-sdk-gen";

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const HOUR_MS = 3_600_000;

const abandonSvc = service({
  name: "abandon",
  handlers: {
    // Fire-and-forget: the spawned routine performs one journaled step,
    // then parks on a sleep far beyond test-time. The handler returns
    // as soon as the main routine settles; the spawned routine is
    // abandoned mid-flight. Under the old wait-for-all semantics this
    // handler would hang for an hour.
    *fireAndForget(): Operation<string> {
      const background = (): Operation<void> =>
        (function* (): Operation<void> {
          yield* run(
            async () => {
              await wait(10);
              return "bg-started";
            },
            { name: "bg-step-1" }
          );
          yield* sleep(HOUR_MS, "bg-sleep");
          yield* run(async () => "never-runs", { name: "bg-step-2" });
        })();
      spawn(background());
      return yield* run(
        async () => {
          await wait(30);
          return "main-result";
        },
        { name: "main-step" }
      );
    },

    // Race where the losing routine would never settle in test-time.
    // The winner's value is returned and the loser is abandoned when
    // the handler returns — the documented race-loser hang is gone.
    *raceWithStuckLoser(): Operation<string> {
      const stuck = spawn(
        (function* (): Operation<string> {
          yield* sleep(HOUR_MS, "stuck-sleep");
          return yield* run(async () => "slow", { name: "slow-step" });
        })()
      );
      const fast = run(
        async () => {
          await wait(10);
          return "fast";
        },
        { name: "fast-step" }
      );
      return yield* race([fast, stuck]);
    },
  },
});

const modes = [
  { name: "default", alwaysReplay: false },
  { name: "alwaysReplay", alwaysReplay: true },
] as const;

describe.each(modes)("abandon — $name mode", ({ alwaysReplay }) => {
  let env: RestateTestEnvironment;
  let ingress: clients.GenIngress;

  beforeAll(async () => {
    env = await RestateTestEnvironment.start({
      services: [abandonSvc],
      alwaysReplay,
    });
    ingress = clients.connect({ url: env.baseUrl() });
  });

  afterAll(async () => {
    await env?.stop();
  });

  test("fire-and-forget spawn parked on a never-settling source does not hang the handler", async () => {
    const client = clients.client(ingress, abandonSvc);
    expect(await client.fireAndForget()).toBe("main-result");
  });

  test("race loser routine parked on a never-settling source is abandoned, winner returned", async () => {
    const client = clients.client(ingress, abandonSvc);
    expect(await client.raceWithStuckLoser()).toBe("fast");
  });
});
