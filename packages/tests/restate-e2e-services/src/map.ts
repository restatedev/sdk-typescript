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
export const MapServiceFQN = "MapObject";

const o = restate.object({
  name: MapServiceFQN,
  handlers: {
    async clearAll(
      ctx: restate.ObjectContext
    ): Promise<Array<{ key: string; value: string }>> {
      const keys = await ctx.stateKeys();
      const entries = [];
      for (const key of keys) {
        const value = await ctx.get<string>(key);
        if (!value) {
          continue;
        }
        entries.push({ key, value });
      }
      ctx.clearAll();
      return entries;
    },

    async get(ctx: restate.ObjectContext, request: string): Promise<string> {
      const value = (await ctx.get<string>(request)) ?? "";
      return value;
    },

    set(ctx: restate.ObjectContext, request: { key: string; value: string }) {
      ctx.set(request.key, request.value);
      return Promise.resolve();
    },
  },
});

REGISTRY.addObject(o);
