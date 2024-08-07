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

    async add(ctx: restate.ObjectContext, value: number) {
      const counter = (await ctx.get<number>(COUNTER_KEY)) ?? 0;
      ctx.set(COUNTER_KEY, counter + value);
    },

    async addThenFail(ctx: restate.ObjectContext, value: number) {
      const counter = (await ctx.get<number>(COUNTER_KEY)) ?? 0;
      ctx.set(COUNTER_KEY, counter + value);
      throw new restate.TerminalError(ctx.key);
    },

    async get(ctx: restate.ObjectContext): Promise<number> {
      return (await ctx.get<number>(COUNTER_KEY)) ?? 0;
    },

    async getAndAdd(
      ctx: restate.ObjectContext,
      request: number
    ): Promise<{ oldValue: number; newValue: number }> {
      const oldValue = (await ctx.get<number>(COUNTER_KEY)) ?? 0;
      const newValue = oldValue + request;
      ctx.set(COUNTER_KEY, newValue);
      return { oldValue, newValue };
    },

    async infiniteIncrementLoop(ctx: restate.ObjectContext) {
      let counter = 1;
      ctx.set(COUNTER_KEY, counter);

      // Wait for the sync with the test runner
      const { id, promise } = ctx.awakeable();
      ctx.objectSendClient(AwakeableHolder, ctx.key).hold(id);
      await promise;

      // Now start looping
      // eslint-disable-next-line no-constant-condition
      while (true) {
        counter++;
        ctx.set(COUNTER_KEY, counter);
        await ctx.sleep(50); // Short sleeps to slow down the loop
      }
    },

    async handleEvent(ctx: restate.ObjectContext, request: string) {
      const value = (await ctx.get<number>(COUNTER_KEY)) || 0;
      ctx.set(COUNTER_KEY, value + parseInt(request));
    },
  },
});

REGISTRY.addObject(service);

export type CounterApi = typeof service;
