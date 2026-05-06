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
// Maps to guide.md §"Working with state". A virtual object owns a
// per-key state slot the SDK persists between invocations. `state()`
// gives you the read-write store; `sharedState()` is the read-only
// view available from `ObjectSharedContext` handlers (concurrent reads
// while no writer holds the key).
//
// Typed state: pass a shape (`{ counter: number }`) to get keyof-checked
// names and per-key value types. Without it, names are `string` and
// values are inferred per call (untyped, like the SDK's default).

import { object, state, sharedState } from "@restatedev/restate-sdk-gen";

type CounterState = {
  counter: number;
};

export const counter = object({
  name: "counter",
  handlers: {
    // Read-only handler: uses sharedState().
    // Multiple `get` invocations can run concurrently for the same key.
    *get() {
      return (yield* sharedState<CounterState>().get("counter")) ?? 0;
    },

    // Read-write handler: uses state(). Exclusive
    // access to the key for the duration of the invocation.
    *add(addend: number) {
      const s = state<CounterState>();
      const oldValue = (yield* s.get("counter")) ?? 0;
      const newValue = oldValue + addend;
      s.set("counter", newValue);
      return { oldValue, newValue };
    },

    // Clear the counter back to zero (well, deletes the entry; `get`
    // returns 0 by falling through the `?? 0`).
    *reset() {
      state<CounterState>().clear("counter");
    },
  },
  options: {
    handlers: {
      get: { shared: true },
    },
  },
});
