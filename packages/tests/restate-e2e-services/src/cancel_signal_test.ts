// Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
//
// This file is part of the Restate e2e tests,
// which are released under the MIT license.
//
// You can find a copy of the license in file LICENSE in the root
// directory of this repository or package, or at
// https://github.com/restatedev/e2e/blob/main/LICENSE

import * as restate from "@restatedev/restate-sdk";
import { type AwakeableHolder } from "./awakeable_holder.js";
import { REGISTRY } from "./services.js";

export const CancelSignalTestRunnerFQN = "CancelSignalTestRunner";
export const CancelSignalBlockingServiceFQN = "CancelSignalBlockingService";
const AwakeableHolder: AwakeableHolder = { name: "AwakeableHolder" };

const cancelSignalTestRunner = restate.object({
  name: CancelSignalTestRunnerFQN,
  handlers: {
    async verifyTest(ctx: restate.ObjectContext): Promise<boolean> {
      return (await ctx.get<boolean>("signalObserved")) ?? false;
    },

    async startTest(ctx: restate.ObjectContext) {
      try {
        await ctx.objectClient(CancelSignalBlockingService, ctx.key).block();
      } catch (e) {
        if (e instanceof restate.TerminalError && e.code === 409) {
          ctx.set("signalObserved", true);
        } else {
          throw e;
        }
      }
    },
  },
});

const cancelSignalBlockingService = restate.object({
  name: CancelSignalBlockingServiceFQN,
  handlers: {
    async block(ctx: restate.ObjectContext) {
      const { id, promise } = ctx.awakeable();
      await ctx.objectClient(AwakeableHolder, ctx.key).hold(id);
      await promise;

      const signal = ctx.request().cancellationSignal;

      await new Promise<void>((_resolve, reject) => {
        if (signal.aborted) {
          reject(signal.reason as Error);
          return;
        }
        signal.addEventListener(
          "abort",
          () => {
            reject(signal.reason as Error);
          },
          { once: true }
        );
      });
    },

    async isUnlocked() {},
  },
});

REGISTRY.addObject(cancelSignalTestRunner);
REGISTRY.addObject(cancelSignalBlockingService);

const CancelSignalBlockingService: typeof cancelSignalBlockingService = {
  name: CancelSignalBlockingServiceFQN,
};
