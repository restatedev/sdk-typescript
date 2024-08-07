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

const COUNTER_KEY = "counter";

const AwakeableHolder: AwakeableHolder = { name: "AwakeableHolder" };

const service = restate.object({
  name: "Counter",
  handlers: {
    reset(ctx: restate.ObjectContext) {
      ctx.clear(COUNTER_KEY);
      return Promise.resolve();
    },

    async get(ctx: restate.ObjectContext): Promise<number> {
      return (await ctx.get<number>(COUNTER_KEY)) ?? 0;
    },

    async add(ctx: restate.ObjectContext, value: number) {
      const counter = (await ctx.get<number>(COUNTER_KEY)) ?? 0;
      ctx.set(COUNTER_KEY, counter + value);
      return { oldValue: counter, newValue: counter + value };
    },

    async addThenFail(ctx: restate.ObjectContext, value: number) {
      const counter = (await ctx.get<number>(COUNTER_KEY)) ?? 0;
      ctx.set(COUNTER_KEY, counter + value);
      throw new restate.TerminalError(ctx.key);
    },
  },
});

REGISTRY.addObject(service);

export type CounterApi = typeof service;
