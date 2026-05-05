// Counter — virtual object exercising basic state I/O.
// Written in the free-standing style: handler bodies call `state()` /
// `sharedState()` directly, no `ops` parameter.
// Mirrors sdk-ruby/test-services/services/counter.rb.

import * as restate from "@restatedev/restate-sdk";
import { gen, execute, state, sharedState } from "@restatedev/restate-sdk-gen";

type CounterState = {
  counter: number;
};

export const counterObject = restate.object({
  name: "Counter",
  handlers: {
    reset: async (ctx: restate.ObjectContext): Promise<void> =>
      execute(
        ctx,
        gen(function* () {
          state<CounterState>().clear("counter");
        })
      ),

    get: async (ctx: restate.ObjectSharedContext): Promise<number> =>
      execute(
        ctx,
        gen(function* () {
          return (yield* sharedState<CounterState>().get("counter")) ?? 0;
        })
      ),

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

    addThenFail: async (
      ctx: restate.ObjectContext,
      addend: number
    ): Promise<void> =>
      execute(
        ctx,
        gen(function* () {
          const s = state<CounterState>();
          const oldValue = (yield* s.get("counter")) ?? 0;
          s.set("counter", oldValue + addend);
          throw new restate.TerminalError(ctx.key);
        })
      ),
  },
});
