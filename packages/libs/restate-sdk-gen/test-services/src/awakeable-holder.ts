// AwakeableHolder — virtual object that holds a single awakeable id and
// exposes resolve / has-it / hold operations. Used by other test
// services (cancel, kill, command-interpreter) for cross-handler coord.
// Mirrors sdk-ruby/test-services/services/awakeable_holder.rb.

import * as restate from "@restatedev/restate-sdk";
import {
  gen,
  execute,
  state,
  sharedState,
  resolveAwakeable,
} from "@restatedev/restate-sdk-gen";

type HolderState = {
  id: string;
};

export const awakeableHolder = restate.object({
  name: "AwakeableHolder",
  handlers: {
    hold: async (ctx: restate.ObjectContext, id: string): Promise<void> =>
      execute(
        ctx,
        gen(function* () {
          state<HolderState>().set("id", id);
        })
      ),

    hasAwakeable: async (ctx: restate.ObjectSharedContext): Promise<boolean> =>
      execute(
        ctx,
        gen(function* () {
          const id = yield* sharedState<HolderState>().get("id");
          return id != null;
        })
      ),

    unlock: async (
      ctx: restate.ObjectContext,
      payload: string
    ): Promise<void> =>
      execute(
        ctx,
        gen(function* () {
          const id = yield* state<HolderState>().get("id");
          if (id == null) {
            throw new restate.TerminalError("No awakeable is registered");
          }
          resolveAwakeable(id, payload);
        })
      ),
  },
});
