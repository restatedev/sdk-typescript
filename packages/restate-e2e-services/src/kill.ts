// Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
//
// This file is part of the Restate e2e tests,
// which are released under the MIT license.
//
// You can find a copy of the license in file LICENSE in the root
// directory of this repository or package, or at
// https://github.com/restatedev/e2e/blob/main/LICENSE

import * as restate from "@restatedev/restate-sdk";
import { REGISTRY } from "./services.js";
import type { AwakeableHolder } from "./awakeable_holder.js";

const kill = restate.service({
  name: "KillTestRunner",
  handlers: {
    async startCallTree(ctx: restate.ObjectContext) {
      await ctx.objectClient(killSingleton, "").recursiveCall();
    },
  },
});

const killSingleton = restate.object({
  name: "KillTestSingleton",
  handlers: {
    async recursiveCall(ctx: restate.ObjectContext) {
      const { id, promise } = ctx.awakeable();
      ctx
        .objectSendClient<AwakeableHolder>({ name: "AwakeableHolder" }, "kill")
        .hold(id);
      await promise;

      await ctx.objectClient(killSingleton, "").recursiveCall();
    },

    isUnlocked() {
      return Promise.resolve();
    },
  },
});

REGISTRY.addService(kill);
REGISTRY.addObject(killSingleton);
