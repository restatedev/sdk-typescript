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

const c = restate.service({
  name: "SideEffect",
  handlers: {
    invokeSideEffects: async (ctx: restate.ObjectContext): Promise<number> => {
      let n = 0;

      await ctx.run(() => {
        n += 1;
      });

      await ctx.run(() => {
        n += 1;
      });

      await ctx.run(() => {
        n += 1;
      });

      return n;
    },
  },
});

REGISTRY.addService(c);
