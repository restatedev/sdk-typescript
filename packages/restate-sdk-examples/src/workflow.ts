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

/* eslint-disable @typescript-eslint/no-unused-vars */

import * as restate from "@restatedev/restate-sdk";

interface PaymentRequest {
  amount: number;
  account: string;
}

interface PaymentSuccess {
  account: string;
}

const payment = restate.workflow({
  name: "payment",
  handlers: {
    /**
     * Run is the entry point for the workflow.
     *
     * @param ctx the restate context allows interacting with the restate APIs.
     * @param payment the argument
     * @returns
     */
    run: async (ctx: restate.WorkflowContext, payment: PaymentRequest) => {
      //
      // let's start by validating the workflow input.
      // The input might come directly from restate's ingress or via
      // a typed workflow client (see workflow_client.ts example)
      //

      if (payment.amount < 0) {
        // this will stop the workflow execution
        // and will complete it exceptionally (with a failure)
        throw new restate.TerminalError("Sorry, that is a non-negativity zone");
      }

      await ctx.run("make a payment", async () => {
        //
        // For example use the stripe client to make the payment.
        // <!> Restate will store the result of this block durably, and
        // will make sure that it will not be executed again, once durably committed by restate.
      });

      await ctx.run("notify the user", async () => {
        //
        // use an email delivery service here to notify the user that their payment is being processed
        //
      });

      await ctx.run("emit an event", async () => {
        //
        // publish an event to an external system
        //
      });

      //
      // you can also capture state in a key-value store, that is bound for this workflow execution
      // and is durably stored.

      ctx.set("status", "I'm pretty far in my workflow");

      const _status = (await ctx.get<string>("status")) ?? "¯_(ツ)_/¯";

      //
      // And even wait for an external events/signals as simply as awaiting a promise!
      // (see the paymentWebhook handler below to learn how this promise gets completed)
      //
      const _event = await ctx.promise<PaymentSuccess>("payment.success");

      ctx.set("status", "And now, event the payment had succeed!");

      //
      // For more extensive walkthrough, visit https://docs.restate.dev :-)
      //

      return "success";
    },

    /**
     * PaymentWebhook handler - is triggered directly as a Webhook by our imaginary payment provider.
     */
    paymentWebhook: async (
      ctx: restate.WorkflowSharedContext,
      account: string
    ) => {
      // you can use the body and the headers to verify
      // the signature for example:
      //
      // const body: Uint8Array = ctx.request().body;
      // const headers = ctx.request().headers;
      // verifyWebhook(secret, headers, body)
      //

      // Here we are sending a signal to the main workflow handler,
      // We do it by resolving a promise, check out the main handler 'run' to see
      // how it is being used.
      await ctx.promise<PaymentSuccess>("payment.success").resolve({ account });
    },

    /**
     * Status handler - get the content of the 'status' key-value entry.
     *
     * As with the handler above, this is a shared handler. It has a readonly access to state,
     * and it can run concurrently to the main handler.
     */
    status: (ctx: restate.WorkflowSharedContext) => ctx.get<string>("status"),
  },
});

export type PaymentWorkflow = typeof payment;

restate.endpoint().bind(payment).listen();
