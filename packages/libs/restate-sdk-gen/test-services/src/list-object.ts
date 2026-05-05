// ListObject — virtual object that owns a single list value.
// Mirrors sdk-ruby/test-services/services/list_object.rb.

import * as restate from "@restatedev/restate-sdk";
import { gen, execute, state, sharedState } from "@restatedev/restate-sdk-gen";

type ListState = {
  list: string[];
};

export const listObject = restate.object({
  name: "ListObject",
  handlers: {
    append: async (ctx: restate.ObjectContext, value: string): Promise<void> =>
      execute(
        ctx,
        gen(function* () {
          const s = state<ListState>();
          const list = (yield* s.get("list")) ?? [];
          s.set("list", [...list, value]);
        })
      ),

    get: async (ctx: restate.ObjectSharedContext): Promise<string[]> =>
      execute(
        ctx,
        gen(function* () {
          return (yield* sharedState<ListState>().get("list")) ?? [];
        })
      ),

    clear: async (ctx: restate.ObjectContext): Promise<string[]> =>
      execute(
        ctx,
        gen(function* () {
          const s = state<ListState>();
          const result = (yield* s.get("list")) ?? [];
          s.clear("list");
          return result;
        })
      ),
  },
});
