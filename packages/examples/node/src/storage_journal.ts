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

/*
 * The storage journal mode: the journal is used as a durable store of results, looked up by name,
 * instead of being replayed. The handler doesn't need to be deterministic:
 * on every attempt it runs from the beginning, and the transactions, calls and runs
 * it already executed return their stored result.
 *
 * Transactions are commit points: their state mutations, messages and result are committed atomically.
 */

import {
  handlers,
  object,
  rpc,
  serve,
  service,
  TerminalError,
  type Context,
  type ObjectContext,
} from "@restatedev/restate-sdk";

type Order = { id: string; sku: string; quantity: number };

export const shipping = service({
  name: "shipping",
  handlers: {
    label: async (ctx: Context, orderId: string) => {
      return `label-${orderId}-${ctx.rand.uuidv4().slice(0, 8)}`;
    },
  },
});

export const notifications = service({
  name: "notifications",
  handlers: {
    shipped: async (ctx: Context, orderId: string) => {
      ctx.console.info(`Order ${orderId} shipped`);
    },
  },
});

export const warehouse = object({
  name: "warehouse",
  handlers: {
    restock: handlers.object.exclusive(
      { journal: "storage" },
      async (ctx: ObjectContext, req: { sku: string; quantity: number }) => {
        return ctx.transaction("restock", (tx) =>
          tx.kv.update<number>(
            `stock/${req.sku}`,
            (stock) => (stock ?? 0) + req.quantity
          )
        );
      }
    ),

    order: handlers.object.exclusive(
      { journal: "storage" },
      async (ctx: ObjectContext, order: Order) => {
        // Regular, non-deterministic code: it runs again on every attempt, and that's fine.
        ctx.console.info(
          `Processing order ${order.id} at ${new Date().toISOString()}`
        );

        // Commit point 1
        const left = await ctx.transaction("reserve", (tx) => {
          const stock = tx.kv.get<number>(`stock/${order.sku}`) ?? 0;
          if (stock < order.quantity) {
            // Nothing is committed but the error
            throw new TerminalError(`Not enough ${order.sku}: ${stock} left`);
          }
          tx.kv.set(`stock/${order.sku}`, stock - order.quantity);
          tx.kv.set(`order/${order.id}`, "reserved");
          return stock - order.quantity;
        });

        // A durable call between commit points: issued once, its result is stored in the journal
        const label = await ctx
          .serviceClient(shipping)
          .label(order.id, rpc.opts({ name: "label" }));

        // Commit point 2
        await ctx.transaction("ship", (tx) => {
          tx.kv.set(`order/${order.id}`, `shipped with ${label}`);
          // Sent if and only if this transaction commits
          tx.serviceSendClient(notifications).shipped(order.id);
        });

        return { label, left };
      }
    ),
  },
});

serve({ services: [warehouse, shipping, notifications] });
