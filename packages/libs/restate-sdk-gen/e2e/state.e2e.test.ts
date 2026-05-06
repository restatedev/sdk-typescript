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

// State e2e: a virtual-object counter exercises state() against a real
// Restate runtime — get/set are journaled, clear and clearAll affect
// persistent VO state, keys() returns the live key set.
//
// Two flavors of the API are demonstrated:
//
//   - Typed: state<CounterState>() gives keyof-checked names and
//     per-key value types. get("count") infers Future<number | null>;
//     state.get("nope") would be a type error.
//   - Shared: read-only handlers use sharedState<CounterState>(),
//     which drops set/clear/clearAll from the type — calling them is
//     a compile error, mirroring what the runtime would do anyway
//     (ObjectSharedContext has no write methods).
//
// Both runtime modes: default + alwaysReplay.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import {
  object,
  state,
  sharedState,
  clients,
} from "@restatedev/restate-sdk-gen";

// Typed-state shape for the counter object. Keys and value types here
// flow through to state<CounterState>() at every call site below.
type CounterState = {
  count: number;
  secondary: string;
};

const counterObj = object({
  name: "counter",
  handlers: {
    *add(n: number) {
      const s = state<CounterState>();
      const current = (yield* s.get("count")) ?? 0;
      const next = current + n;
      s.set("count", next);
      return next;
    },

    // Read-only handler — uses sharedState() so writes wouldn't compile.
    *current() {
      return (yield* sharedState<CounterState>().get("count")) ?? 0;
    },

    *keys() {
      return yield* sharedState<CounterState>().keys();
    },

    *setSecondary(value: string) {
      const s = state<CounterState>();
      s.set("secondary", value);
      const count = (yield* s.get("count")) ?? 0;
      return { count, secondary: value };
    },

    *clearSecondary() {
      state<CounterState>().clear("secondary");
    },

    *reset() {
      state<CounterState>().clearAll();
    },
  },
  options: {
    handlers: {
      current: { shared: true },
      keys: { shared: true },
    },
  },
});

const modes = [
  { name: "default", alwaysReplay: false },
  { name: "alwaysReplay", alwaysReplay: true },
] as const;

describe.each(modes)("state — $name mode", ({ alwaysReplay }) => {
  let env: RestateTestEnvironment;
  let ingress: clients.Ingress;

  beforeAll(async () => {
    env = await RestateTestEnvironment.start({
      services: [counterObj],
      alwaysReplay,
    });
    ingress = clients.connect({ url: env.baseUrl() });
  });

  afterAll(async () => {
    await env?.stop();
  });

  test("get/set: counter accumulates across calls", async () => {
    const key = `acc-${alwaysReplay ? "replay" : "default"}`;
    const client = clients.client(ingress, counterObj, key);
    expect(await client.add(1)).toBe(1);
    expect(await client.add(2)).toBe(3);
    expect(await client.add(7)).toBe(10);
    expect(await client.current()).toBe(10);
  });

  test("isolation: each VO key has independent state", async () => {
    const k1 = `iso1-${alwaysReplay ? "replay" : "default"}`;
    const k2 = `iso2-${alwaysReplay ? "replay" : "default"}`;
    const c1 = clients.client(ingress, counterObj, k1);
    const c2 = clients.client(ingress, counterObj, k2);
    await c1.add(5);
    await c2.add(11);
    expect(await c1.current()).toBe(5);
    expect(await c2.current()).toBe(11);
  });

  test("keys(): lists all set keys, drops cleared ones", async () => {
    const key = `keys-${alwaysReplay ? "replay" : "default"}`;
    const client = clients.client(ingress, counterObj, key);
    await client.add(1);
    await client.setSecondary("hello");
    expect((await client.keys()).sort()).toEqual(["count", "secondary"]);
    await client.clearSecondary();
    expect(await client.keys()).toEqual(["count"]);
  });

  test("clearAll: wipes all state for this object", async () => {
    const key = `clear-${alwaysReplay ? "replay" : "default"}`;
    const client = clients.client(ingress, counterObj, key);
    await client.add(42);
    await client.setSecondary("alongside");
    expect((await client.keys()).sort()).toEqual(["count", "secondary"]);
    await client.reset();
    expect(await client.keys()).toEqual([]);
    expect(await client.current()).toBe(0);
  });
});
