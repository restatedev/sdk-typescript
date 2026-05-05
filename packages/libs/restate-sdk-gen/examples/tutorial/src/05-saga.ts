/*
 * Copyright (c) 2023-2026 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

// Tier 5: saga-style compensation.
//
// Maps to guide.md §"Saga-style compensation". Three journaled steps:
// reserve, charge, create. If any later step fails, the catch block
// runs a compensating release — itself journaled, so it survives
// crashes in the middle of the compensation.
//
// Errors thrown as TerminalError are non-retryable; everything else is
// retried by the SDK with backoff.

import * as restate from "@restatedev/restate-sdk";
import { gen, execute, run } from "@restatedev/restate-sdk-gen";
import { reserveItem, chargeCard, createOrder, releaseItem } from "./fakes.js";

type OrderRequest = {
  itemId: string;
  amount: number;
  cardToken: string;
};

type OrderResult = { orderId: string };

export const saga = restate.service({
  name: "saga",
  handlers: {
    placeOrder: async (
      ctx: restate.Context,
      req: OrderRequest
    ): Promise<OrderResult> =>
      execute(
        ctx,
        gen(function* () {
          const reservation = yield* run(() => reserveItem(req.itemId), {
            name: "reserve",
          });
          try {
            const charge = yield* run(
              () => chargeCard(req.amount, req.cardToken),
              { name: "charge" }
            );
            const orderId = yield* run(
              () => createOrder(reservation.id, charge.id),
              { name: "create-order" }
            );
            return { orderId };
          } catch (e) {
            // Compensate the reservation, then surface the original
            // failure to the caller. The release is journaled — if the
            // worker crashes mid-compensation, replay resumes here.
            yield* run(() => releaseItem(reservation.id), { name: "release" });
            throw e;
          }
        })
      ),
  },
});
