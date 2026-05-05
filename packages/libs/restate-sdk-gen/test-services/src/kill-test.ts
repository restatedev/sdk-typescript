// Kill-test — pair of virtual objects driving recursive call trees that
// should be terminated by an external kill. Mirrors
// sdk-ruby/test-services/services/kill_test.rb.

import * as restate from "@restatedev/restate-sdk";
import {
  gen,
  execute,
  awakeable,
  objectClient,
  objectSendClient,
} from "@restatedev/restate-sdk-gen";
import type { awakeableHolder } from "./awakeable-holder.js";

const AwakeableHolderApi: restate.VirtualObjectDefinitionFrom<
  typeof awakeableHolder
> = { name: "AwakeableHolder" };

export const killTestRunner = restate.object({
  name: "KillTestRunner",
  handlers: {
    startCallTree: async (ctx: restate.ObjectContext): Promise<void> =>
      execute(
        ctx,
        gen(function* () {
          yield* objectClient(KillTestSingletonApi, ctx.key).recursiveCall();
        })
      ),
  },
});

const KillTestSingletonApi: restate.VirtualObjectDefinitionFrom<
  typeof killTestSingleton
> = { name: "KillTestSingleton" };

export const killTestSingleton = restate.object({
  name: "KillTestSingleton",
  handlers: {
    recursiveCall: async (ctx: restate.ObjectContext): Promise<void> =>
      execute(
        ctx,
        gen(function* () {
          const { id, promise } = awakeable<string>();
          objectSendClient(AwakeableHolderApi, ctx.key).hold(id);
          yield* promise;
          yield* objectClient(KillTestSingletonApi, ctx.key).recursiveCall();
        })
      ),

    isUnlocked: async (_ctx: restate.ObjectContext): Promise<void> => {
      // No-op probe handler.
    },
  },
});
