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

import * as restate from "@restatedev/restate-sdk";
import { gen, execute, state, sharedState } from "@restatedev/restate-sdk-gen";

type CounterState = {
  counter: number;
};

export const counter = restate.object({
  name: "counter",
  handlers: {
    // Read-only handler: takes ObjectSharedContext, uses sharedState().
    // Multiple `get` invocations can run concurrently for the same key.
    get: async (ctx: restate.ObjectSharedContext): Promise<number> =>
      execute(
        ctx,
        gen(function* () {
          return (yield* sharedState<CounterState>().get("counter")) ?? 0;
        })
      ),

    // Read-write handler: takes ObjectContext, uses state(). Exclusive
    // access to the key for the duration of the invocation.
    add: async (
      ctx: restate.ObjectContext,
      addend: number
    ): Promise<{ oldValue: number; newValue: number }> =>
      execute(
        ctx,
        gen(function* () {
          const s = state<CounterState>();
          const oldValue = (yield* s.get("counter")) ?? 0;
          const newValue = oldValue + addend;
          s.set("counter", newValue);
          return { oldValue, newValue };
        })
      ),

    // Clear the counter back to zero (well, deletes the entry; `get`
    // returns 0 by falling through the `?? 0`).
    reset: async (ctx: restate.ObjectContext): Promise<void> =>
      execute(
        ctx,
        gen(function* () {
          state<CounterState>().clear("counter");
        })
      ),
  },
});
