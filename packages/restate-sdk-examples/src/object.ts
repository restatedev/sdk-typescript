/*
 * Copyright (c) 2023-2024 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

import { object, serve } from "@restatedev/restate-sdk";

export const counter = object({
  name: "counter",
  handlers: {
    add: async (ctx, amount: number) => {
      const current = await ctx.get<number>("count");
      const updated = (current ?? 0) + amount;
      ctx.set("count", updated);
      return updated;
    },
    /**
     * Get the current amount.
     *
     * Notice that VirtualObjects can have "shared" handlers.
     * These handlers can be executed concurrently to the exclusive handlers (i.e. add)
     * But they can not modify the state (set is missing from the ctx).
     */
    current: {
      sharedHandler: async (ctx) => {
        return (await ctx.get<number>("count")) ?? 0;
      },
    },
    clear: {
      handler: async (ctx) => {
        ctx.clearAll();
      },
      enableLazyState: true,
    },
  },
});

export type Counter = typeof counter;

serve({ services: [counter] });
