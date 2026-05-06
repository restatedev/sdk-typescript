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

// State e2e: a virtual-object counter exercises the new per-key accessor API
// against a real Restate runtime.
//
// Demonstrates:
//   - state(config) defined at module level (lazy — resolves ops on method call).
//     count has default 0 → get() returns Future<number> (never null).
//     secondary uses typed<string>() → get() returns Future<string | null>.
//   - state(config) with factory default (closure) for mutable defaults.
//   - getAllStateKeys(): list live keys.
//   - clear() on per-key accessors.
//
// Both runtime modes: default + alwaysReplay.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import * as restate from "@restatedev/restate-sdk";
import * as clients from "@restatedev/restate-sdk-clients";
import { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import {
  gen,
  execute,
  state,
  typed,
  getAllStateKeys,
} from "@restatedev/restate-sdk-gen";

// Defined once at module level — lazy, resolves ops only when methods are called.
// count has a static default 0 (get returns Future<number>).
// secondary uses typed<string>() — typed but no default (get returns Future<string | null>).
const counterState = state({
  count: { default: 0 },
  secondary: typed<string>(),
});

const counterObj = restate.object({
  name: "counter",
  handlers: {
    add: async (ctx: restate.ObjectContext, n: number): Promise<number> =>
      execute(
        ctx,
        gen(function* () {
          const current = yield* counterState.count.get(); // Future<number>
          const next = current + n;
          counterState.count.set(next);
          return next;
        })
      ),

    current: async (ctx: restate.ObjectSharedContext): Promise<number> =>
      execute(
        ctx,
        gen(function* () {
          return yield* counterState.count.get(); // still Future<number> — default 0
        })
      ),

    keys: async (ctx: restate.ObjectSharedContext): Promise<string[]> =>
      execute(
        ctx,
        gen(function* () {
          return yield* getAllStateKeys();
        })
      ),

    setSecondary: async (
      ctx: restate.ObjectContext,
      value: string
    ): Promise<{ count: number; secondary: string }> =>
      execute(
        ctx,
        gen(function* () {
          counterState.secondary.set(value);
          const count: number = yield* counterState.count.get();
          return { count, secondary: value };
        })
      ),

    clearSecondary: async (ctx: restate.ObjectContext): Promise<void> =>
      execute(
        ctx,
        gen(function* () {
          counterState.secondary.clear();
        })
      ),

    reset: async (ctx: restate.ObjectContext): Promise<void> =>
      execute(
        ctx,
        gen(function* () {
          counterState.count.clear();
          counterState.secondary.clear();
        })
      ),
  },
});

const listState = state({
  items: { default: () => [] as string[] },
});

// Object for testing factory defaults.
const listObj = restate.object({
  name: "list",
  handlers: {
    get: async (ctx: restate.ObjectSharedContext) =>
      execute(
        ctx,
        gen(function* () {
          return { items: yield* listState.items.get() };
        })
      ),

    append: async (ctx: restate.ObjectContext, item: string): Promise<void> =>
      execute(
        ctx,
        gen(function* () {
          const current = yield* listState.items.get();
          listState.items.set([...current, item]);
        })
      ),
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
      services: [counterObj, listObj],
      alwaysReplay,
    });
    ingress = clients.connect({ url: env.baseUrl() });
  });

  afterAll(async () => {
    await env?.stop();
  });

  test("get/set: counter accumulates across calls", async () => {
    const key = `acc-${alwaysReplay ? "replay" : "default"}`;
    const client = ingress.objectClient(counterObj, key);
    expect(await client.add(1)).toBe(1);
    expect(await client.add(2)).toBe(3);
    expect(await client.add(7)).toBe(10);
    expect(await client.current()).toBe(10);
  });

  test("static default: count returns 0 for a fresh object", async () => {
    const key = `fresh-${alwaysReplay ? "replay" : "default"}`;
    expect(await ingress.objectClient(counterObj, key).current()).toBe(0);
  });

  test("isolation: each VO key has independent state", async () => {
    const k1 = `iso1-${alwaysReplay ? "replay" : "default"}`;
    const k2 = `iso2-${alwaysReplay ? "replay" : "default"}`;
    await ingress.objectClient(counterObj, k1).add(5);
    await ingress.objectClient(counterObj, k2).add(11);
    expect(await ingress.objectClient(counterObj, k1).current()).toBe(5);
    expect(await ingress.objectClient(counterObj, k2).current()).toBe(11);
  });

  test("keys(): lists all set keys, drops cleared ones", async () => {
    const key = `keys-${alwaysReplay ? "replay" : "default"}`;
    const client = ingress.objectClient(counterObj, key);
    await client.add(1);
    await client.setSecondary("hello");
    expect((await client.keys()).sort()).toEqual(["count", "secondary"]);
    await client.clearSecondary();
    expect(await client.keys()).toEqual(["count"]);
  });

  test("reset: clears all keys", async () => {
    const key = `clear-${alwaysReplay ? "replay" : "default"}`;
    const client = ingress.objectClient(counterObj, key);
    await client.add(42);
    await client.setSecondary("alongside");
    expect((await client.keys()).sort()).toEqual(["count", "secondary"]);
    await client.reset();
    expect(await client.keys()).toEqual([]);
    expect(await client.current()).toBe(0);
  });

  test("factory default: fresh VO key starts with an empty array", async () => {
    const key = `factory-${alwaysReplay ? "replay" : "default"}`;
    const client = ingress.objectClient(listObj, key);
    expect((await client.get()).items).toEqual([]);
    await client.append("a");
    await client.append("b");
    expect((await client.get()).items).toEqual(["a", "b"]);
  });

  test("factory default: each VO key gets its own independent array", async () => {
    const k1 = `factory-iso1-${alwaysReplay ? "replay" : "default"}`;
    const k2 = `factory-iso2-${alwaysReplay ? "replay" : "default"}`;
    await ingress.objectClient(listObj, k1).append("x");
    expect((await ingress.objectClient(listObj, k2).get()).items).toEqual([]);
  });
});
