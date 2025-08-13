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

import {
  createObjectHandler,
  createObjectSharedHandler,
  object,
  serve,
  state,
} from "@restatedev/restate-sdk";
import { serde } from "@restatedev/restate-sdk-core";

const myState = state<{ count: number; somethingElse?: string }>({ count: 0 });

export const counter = object({
  name: "counter",
  state: myState,
  handlers: {
    /**
     * Add amount to the currently stored count
     */
    add: async (ctx, amount: number) => {
      const current = await ctx.get("count");
      const updated = current + amount;
      ctx.set("count", updated);
      return updated;
    },

    current: {
        shared: true,
        fn: async (ctx) => {
            return await ctx.get("count");
        }
    },

    /**
     * Get the current amount.
     *
     * Notice that VirtualObjects can have "shared" handlers.
     * These handlers can be executed concurrently to the exclusive handlers (i.e. add)
     * But they can not modify the state (set is missing from the ctx).
     */
    // current: createObjectSharedHandler<number, void, { count: number; somethingElse?: string }>(
    //   async (ctx): Promise<number> => {
    //     return (await ctx.get("count")) ?? 0;
    //   }
    // ),

    /**
     * Handlers (shared or exclusive) can be configured to bypass JSON serialization,
     * by specifying the input (accept) and output (contentType) content types.
     *
     * to call that handler with binary data, you can use the following curl command:
     * curl -X POST -H "Content-Type: application/octet-stream" --data-binary 'hello' ${RESTATE_INGRESS_URL}/counter/mykey/binary
     */
    // binary: createObjectHandler(
    //   {
    //     input: serde.binary,
    //     output: serde.binary,
    //   },
    //   async (ctx, data: Uint8Array) => {
    //     // console.log("Received binary data", data);
    //     return data;
    //   }
    // ),
  },
});

export type Counter = typeof counter;

serve({ services: [counter] });
