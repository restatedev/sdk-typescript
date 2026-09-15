/*
 * Copyright (c) 2023-2025 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

// Authored with the stock TanStack API. Nothing here knows it runs on Restate,
// which is the point: the authoring surface is reused verbatim.

import { createWorkflow } from "@tanstack/workflow-core";
import { z } from "zod";

export const charges: Array<{ customer: string; idempotencyKey: string }> = [];
export const receipts: string[] = [];

export const checkout = createWorkflow({
  id: "checkout",
  input: z.object({ userId: z.string(), amount: z.number() }),
  output: z.object({ status: z.enum(["approved", "rejected"]) }),
}).handler(async (ctx) => {
  const charge = await ctx.step("charge-card", (stepCtx) => {
    charges.push({ customer: ctx.input.userId, idempotencyKey: stepCtx.id });
    return { id: `ch_${charges.length}` };
  });

  if (ctx.input.amount > 10_000) {
    const decision = await ctx.approve({ title: "Approve large charge?" });
    if (!decision.approved) return { status: "rejected" as const };
  }

  await ctx.step("send-receipt", () => {
    receipts.push(charge.id);
  });
  return { status: "approved" as const };
});

/** Returns a value its own output schema rejects, to exercise output validation. */
export const badOutput = createWorkflow({
  id: "bad-output",
  input: z.object({ userId: z.string() }),
  output: z.object({ status: z.enum(["approved", "rejected"]) }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}).handler(async () => ({ status: "not-a-valid-status" }) as any);
