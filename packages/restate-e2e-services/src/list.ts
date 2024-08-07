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

const LIST_KEY = "list";

const o = restate.object({
  name: "ListObject",
  handlers: {
    async append(ctx: restate.ObjectContext, request: string): Promise<void> {
      const list = (await ctx.get<string[]>(LIST_KEY)) ?? [];
      list.push(request);
      ctx.set(LIST_KEY, list);
    },

    async clear(ctx: restate.ObjectContext) {
      const list = (await ctx.get<string[]>(LIST_KEY)) ?? [];
      ctx.clear(LIST_KEY);
      return list;
    },

    async get(ctx: restate.ObjectContext): Promise<string[]> {
      return (await ctx.get<string[]>(LIST_KEY)) ?? [];
    },
  },
});

REGISTRY.addObject(o);
