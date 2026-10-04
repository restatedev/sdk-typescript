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
 * Actors: virtual objects whose handlers run as a single transaction.
 *
 * An actor handler doesn't record its steps in the journal: it runs against a synchronous,
 * in-memory key-value view of the actor state, and when it returns,
 * its state mutations, its outgoing messages and its result are committed atomically.
 */

import {
  actor,
  handlers,
  rpc,
  serve,
  service,
  TerminalError,
  type ActorContext,
  type ActorSharedContext,
  type Context,
} from "@restatedev/restate-sdk";

type CartItem = { sku: string; quantity: number };

const CART_TTL_MILLIS = 60 * 60 * 1000;

export const orders = service({
  name: "orders",
  handlers: {
    place: async (ctx: Context, order: { cart: string; items: CartItem[] }) => {
      ctx.console.info(
        `Placing order for cart ${order.cart}: ${JSON.stringify(order.items)}`
      );
    },
  },
});

export const cart = actor({
  name: "cart",
  handlers: {
    /**
     * Add an item, returns the new quantity of that item.
     */
    add: async (ctx: ActorContext, item: CartItem): Promise<number> => {
      const quantity = ctx.kv.update<number>(
        `item/${item.sku}`,
        (current) => (current ?? 0) + item.quantity
      )!;

      // Timers are delayed messages to self, committed together with the state.
      if (!ctx.kv.has("expiresAt")) {
        ctx
          .objectSendClient(Cart, ctx.key)
          .expire(rpc.sendOpts({ delay: CART_TTL_MILLIS }));
      }
      ctx.kv.set("expiresAt", Date.now() + CART_TTL_MILLIS);

      return quantity;
    },

    /**
     * Remove an item, returns true if the item was in the cart.
     */
    remove: async (ctx: ActorContext, sku: string): Promise<boolean> => {
      return ctx.kv.delete(`item/${sku}`);
    },

    /**
     * Place an order with the cart content and empty the cart.
     *
     * The order message is sent if and only if the cart is emptied.
     */
    checkout: async (ctx: ActorContext): Promise<CartItem[]> => {
      const items = cartItems(ctx);
      if (items.length === 0) {
        // Terminal errors abort the transaction: nothing is committed but the error
        throw new TerminalError("The cart is empty");
      }
      ctx.serviceSendClient(orders).place({ cart: ctx.key, items });
      ctx.kv.clear();
      return items;
    },

    expire: async (ctx: ActorContext) => {
      const expiresAt = ctx.kv.get<number>("expiresAt");
      if (expiresAt === undefined) {
        return;
      }
      if (expiresAt <= Date.now()) {
        ctx.kv.clear();
      } else {
        ctx
          .objectSendClient(Cart, ctx.key)
          .expire(rpc.sendOpts({ delay: expiresAt - Date.now() }));
      }
    },

    /**
     * Read-only handlers run concurrently, and observe the last committed state.
     */
    items: handlers.actor.shared(
      async (ctx: ActorSharedContext): Promise<CartItem[]> => cartItems(ctx)
    ),
  },
});

const Cart: typeof cart = { name: "cart" } as typeof cart;

function cartItems(ctx: ActorSharedContext): CartItem[] {
  return ctx.kv
    .entries<number>("item/")
    .map(([key, quantity]) => ({ sku: key.slice("item/".length), quantity }));
}

serve({ services: [cart, orders] });
