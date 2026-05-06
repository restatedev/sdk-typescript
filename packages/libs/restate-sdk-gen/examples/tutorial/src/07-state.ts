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

// Tier 7: virtual-object state.
//
// Two APIs:
//
//   state(config) — per-key typed accessors. Each key in the config gets a
//     .get() / .set() / .clear() accessor. Keys with a `default` return
//     Future<T> (never null); others return Future<T | null>.
//
//   state<TShape>() — per-key accessors without config. All keys return
//     Future<T | null>.
//
//   getState / setState / clearState / clearAllState / getAllStateKeys —
//     flat untyped functions for dynamic key names or simple cases.

import * as restate from "@restatedev/restate-sdk";
import {
  gen,
  execute,
  state,
  getState,
  setState,
  clearState,
  getAllStateKeys,
} from "@restatedev/restate-sdk-gen";

// Description of the state fields used by counter
const counterState = state({
  counter: { default: 0 },
});

export const counter = restate.object({
  name: "counter",
  handlers: {
    // Read-only handler: shared context, uses state() (same API — write
    // methods throw at runtime in a shared context).
    get: async (ctx: restate.ObjectSharedContext): Promise<number> =>
      execute(
        ctx,
        gen(function* () {
          // Default is 0 — no null-coalescing needed.
          return yield* counterState.counter.get();
        })
      ),

    // Read-write handler: default applied, so no ?? needed.
    add: async (
      ctx: restate.ObjectContext,
      addend: number
    ): Promise<{ oldValue: number; newValue: number }> =>
      execute(
        ctx,
        gen(function* () {
          const oldValue: number = yield* counterState.counter.get(); // Future<number>
          const newValue = oldValue + addend;
          counterState.counter.set(newValue);
          return { oldValue, newValue };
        })
      ),

    // Using state<TShape>() — all keys nullable.
    addLegacy: async (
      ctx: restate.ObjectContext,
      addend: number
    ): Promise<number> =>
      execute(
        ctx,
        gen(function* () {
          const oldValue = yield* counterState.counter.get() ?? 0; // Future<number | null>
          const newValue = oldValue + addend;
          counterState.counter.set(newValue);
          return newValue;
        })
      ),

    reset: async (ctx: restate.ObjectContext): Promise<void> =>
      execute(
        ctx,
        gen(function* () {
          counterState.counter.clear();
        })
      ),

    // Flat untyped API — useful when key names are dynamic.
    setRaw: async (
      ctx: restate.ObjectContext,
      payload: { key: string; value: string }
    ): Promise<void> =>
      execute(
        ctx,
        gen(function* () {
          setState(payload.key, payload.value);
        })
      ),

    getRaw: async (
      ctx: restate.ObjectContext,
      key: string
    ): Promise<string | null> =>
      execute(
        ctx,
        gen(function* () {
          return yield* getState<string>(key);
        })
      ),

    clearRaw: async (ctx: restate.ObjectContext, key: string): Promise<void> =>
      execute(
        ctx,
        gen(function* () {
          clearState(key);
        })
      ),

    keys: async (ctx: restate.ObjectSharedContext): Promise<string[]> =>
      execute(
        ctx,
        gen(function* () {
          return yield* getAllStateKeys();
        })
      ),
  },
});
