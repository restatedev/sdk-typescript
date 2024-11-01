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

import * as restate from "@restatedev/restate-sdk";

export const counter = restate.object({
  name: "counter",
  handlers: {
    /**
     * Add amount to the currently stored count
     */
    add: async (ctx: restate.ObjectContext, amount: number) => {
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
    current: restate.handlers.object.shared(
      async (ctx: restate.ObjectSharedContext): Promise<number> => {
        return (await ctx.get("count")) ?? 0;
      }
    ),

    /**
     * Handlers (shared or exclusive) can be configured to bypass JSON serialization,
     * by specifying the input (accept) and output (contentType) content types.
     *
     * to call that handler with binary data, you can use the following curl command:
     * curl -X POST -H "Content-Type: application/octet-stream" --data-binary 'hello' ${RESTATE_INGRESS_URL}/counter/mykey/binary
     */
    binary: restate.handlers.object.exclusive(
      {
        input: restate.serde.binary,
        output: restate.serde.binary,
      },
      async (ctx: restate.ObjectContext, data: Uint8Array) => {
        // console.log("Received binary data", data);
        return data;
      }
    ),
  },
});

export type Counter = typeof counter;

restate.endpoint().bind(counter).listen();
