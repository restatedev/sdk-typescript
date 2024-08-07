// Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
//
// This file is part of the Restate e2e tests,
// which are released under the MIT license.
//
// You can find a copy of the license in file LICENSE in the root
// directory of this repository or package, or at
// https://github.com/restatedev/e2e/blob/main/LICENSE

import * as restate from "@restatedev/restate-sdk";
import { AwakeableHolder } from "./awakeable_holder.js";
import { REGISTRY } from "./services.js";

export const CancelTestServiceFQN = "CancelTestRunner";
export const BlockingServiceFQN = "CancelTestBlockingService";
const AwakeableHolder: AwakeableHolder = { name: "AwakeableHolder" };

enum BlockingOperation {
  CALL = "CALL",
  SLEEP = "SLEEP",
  AWAKEABLE = "AWAKEABLE",
}

const cancelService = restate.object({
  name: CancelTestServiceFQN,
  handlers: {
    async verifyTest(ctx: restate.ObjectContext): Promise<boolean> {
      const isCanceled = (await ctx.get<boolean>("canceled")) ?? false;
      return isCanceled;
    },

    async startTest(ctx: restate.ObjectContext, request: BlockingOperation) {
      try {
        await ctx.objectClient(BlockingService, ctx.key).block(request);
      } catch (e) {
        if (e instanceof restate.TerminalError && e.code === 409) {
          ctx.set("canceled", true);
        } else {
          throw e;
        }
      }
    },
  },
});

const blockingService = restate.object({
  name: BlockingServiceFQN,
  handlers: {
    async block(ctx: restate.ObjectContext, request: BlockingOperation) {
      const { id, promise } = ctx.awakeable();
      // DO NOT await the next CALL otherwise the test deadlocks.
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      ctx.objectClient(AwakeableHolder, "cancel").hold(id);
      await promise;

      switch (request) {
        case BlockingOperation.CALL: {
          await ctx.objectClient(BlockingService, ctx.key).block(request);
          break;
        }
        case BlockingOperation.SLEEP: {
          await ctx.sleep(1_000_000_000);
          break;
        }
        case BlockingOperation.AWAKEABLE: {
          const { promise } = ctx.awakeable();
          // uncompletable promise >
          await promise;
          break;
        }
      }
    },

    async isUnlocked() {},
  },
});

REGISTRY.addObject(cancelService);
REGISTRY.addObject(blockingService);

const BlockingService: typeof blockingService = {
  name: "CancelTestBlockingService",
};
