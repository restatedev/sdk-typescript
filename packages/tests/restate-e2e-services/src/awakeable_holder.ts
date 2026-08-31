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

const ID_KEY = "id";

export const AwakeableHolder = restate.iface.object("AwakeableHolder", {
  hold: restate.iface.json<string, void>(),
  hasAwakeable: restate.iface.json<void, boolean>(),
  unlock: restate.iface.json<string, void>(),
});

const impl = restate.implement(AwakeableHolder, {
  handlers: {
    hold(ctx, id) {
      ctx.set(ID_KEY, id);
      return Promise.resolve();
    },

    async hasAwakeable(ctx): Promise<boolean> {
      const maybe = await ctx.get<string>(ID_KEY);
      return maybe !== null && maybe !== undefined;
    },

    async unlock(ctx, request) {
      const id = await ctx.get<string>(ID_KEY);
      if (id === null || id === undefined) {
        throw new Error("No awakeable registered");
      }
      ctx.resolveAwakeable(id, request);
      ctx.clear(ID_KEY);
    },
  },
});

REGISTRY.addObject(impl);
