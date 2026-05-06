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

// Channel<T> e2e: validates channel patterns end-to-end against a real
// Restate runtime. Channels are pure scheduler primitives — never enter
// `lib.race`, never journal — but they must remain deterministic across
// the SDK's suspend/replay cycle. alwaysReplay mode is the headline
// test: each replay reconstructs the channel from scratch, and the
// workflow logic must drive sends/receives at deterministic points so
// the same select branch wins on every replay.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import {
  service,
  spawn,
  run,
  sleep,
  channel,
  select,
  all,
  type Operation,
  clients,
} from "@restatedev/restate-sdk-gen";

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const channelsSvc = service({
  name: "channels",
  handlers: {
    // Simplest channel use: send and receive in the same fiber.
    // Pre-fire pattern — channel is already settled when the receive
    // yield happens, so it short-circuits via parkOnLeaf's sync-resolve.
    *basicSend(value: string): Operation<string> {
      const ch = channel<string>();
      yield* ch.send(value);
      return yield* ch.receive;
    },

    // Spawn a coordinator fiber that sends; the parent receives. Tests
    // that the cross-fiber wake path works (fireOnce → wake → markReady
    // → drainReady → parent advances).
    *spawnCoordinate(value: string): Operation<string> {
      const ch = channel<string>();
      yield* spawn(
        (function* () {
          yield* ch.send(value);
        })()
      );
      return yield* ch.receive;
    },

    // Three readers, one sender. Settle-once Future means all three
    // observe the same value — channels function as a one-time
    // broadcast.
    *multiReaderBroadcast(value: string): Operation<string> {
      const ch = channel<string>();
      const reader = (label: string): Operation<string> =>
        (function* () {
          const v = yield* ch.receive;
          return `${label}:${v}`;
        })();
      const ta = yield* spawn(reader("A"));
      const tb = yield* spawn(reader("B"));
      const tc = yield* spawn(reader("C"));
      yield* spawn(
        (function* () {
          yield* ch.send(value);
        })()
      );
      const vs = yield* all([ta, tb, tc]);
      return vs.join("|");
    },

    // Typed channel carrying structured data: a worker selects over
    // long-running work and a stop channel; the parent sends a reason
    // after a short delay; the worker observes and reports the reason.
    *stopWithReason(req: { reason: string }): Operation<string> {
      const stop = channel<{ reason: string }>();

      const worker: Operation<string> = (function* () {
        const r = yield* select({
          work: run(
            async () => {
              await wait(10_000);
              return "completed";
            },
            { name: "slow" }
          ),
          stop: stop.receive,
        });
        if (r.tag === "stop") {
          const { reason } = yield* r.future;
          return `stopped:${reason}`;
        }
        return `done:${yield* r.future}`;
      })();

      const t = yield* spawn(worker);
      yield* sleep({ milliseconds: 100 });
      yield* stop.send({ reason: req.reason });
      return yield* t;
    },
  },
});

const modes = [
  { name: "default", alwaysReplay: false },
  { name: "alwaysReplay", alwaysReplay: true },
] as const;

describe.each(modes)("channels — $name mode", ({ alwaysReplay }) => {
  let env: RestateTestEnvironment;
  let ingress: clients.Ingress;

  beforeAll(async () => {
    env = await RestateTestEnvironment.start({
      services: [channelsSvc],
      alwaysReplay,
    });
    ingress = clients.connect({ url: env.baseUrl() });
  });

  afterAll(async () => {
    await env?.stop();
  });

  test("basic send/receive in the same fiber", async () => {
    const client = clients.client(ingress, channelsSvc);
    expect(await client.basicSend("hello")).toBe("hello");
  });

  test("spawn coordinate: spawned fiber sends, parent receives", async () => {
    const client = clients.client(ingress, channelsSvc);
    expect(await client.spawnCoordinate("from-spawn")).toBe("from-spawn");
  });

  test("multi-reader broadcast: all readers see the same value", async () => {
    const client = clients.client(ingress, channelsSvc);
    expect(await client.multiReaderBroadcast("payload")).toBe(
      "A:payload|B:payload|C:payload"
    );
  });

  test("stop with reason: typed channel carrying structured data", async () => {
    const client = clients.client(ingress, channelsSvc);
    expect(await client.stopWithReason({ reason: "user-cancelled" })).toBe(
      "stopped:user-cancelled"
    );
  });
});
