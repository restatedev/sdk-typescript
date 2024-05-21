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

const greeter = restate.service({
  name: "greeter",
  handlers: {
    greet: async (ctx: restate.Context, name: string) => {
      // blocking RPC call to a keyed service (here supplying type and path separately)
      const countSoFar = await ctx.objectClient(Counter, name).count();

      const message = `Hello ${name}, for the ${countSoFar + 1}th time!`;

      // sending messages to ourselves, immediately and delayed
      ctx.serviceSendClient(Greeter).logger(message);
      ctx
        .serviceSendClient(Greeter, { delay: 100 })
        .logger("delayed " + message);

      return message;
    },

    logger: async (ctx: restate.Context, msg: string) => {
      ctx.console.log(" HEEEELLLLOOOOO! " + msg);
    },
  },
});

export type GreeterService = typeof greeter;
const Greeter: GreeterService = { name: "greeter" };

//
// The stateful aux service that keeps the counts.
// This could in principle be the same service as the greet service, we just separate
// them here to have this multi-service setup for testing.
//

const counter = restate.object({
  name: "counter",
  handlers: {
    count: restate.handlers.object.exclusive(
      async (ctx: restate.ObjectContext) => {
        const seen = (await ctx.get<number>("seen")) ?? 0;
        //ctx.set("seen", seen + 1);

        const ans = await ctx.workflowClient(WF, "bob").run("sdf");
        ctx.console.log(ans);

        return seen;
      }
    ),

    get: restate.handlers.object.shared(
      async (ctx: restate.ObjectSharedContext): Promise<number> => {
        return (await ctx.get("count")) ?? 0;
      }
    ),
  },
});

const myWorkflow = restate.wf({
  name: "hello",
  handlers: {
    //run: async (ctx: restate.WorkflowContext, arg: string) => {
    run: async (ctx: restate.WorkflowContext, arg: string) => {
      let n = (await ctx.get<number>("n")) ?? 0;
      n += 1;
      ctx.set("n", n);
      return "hi " + arg + " " + n;
    },

    webhook: async (ctx: restate.WorkflowSharedContext, arg: string) => {
      return arg;
    },
  },
});

export type MyWorkflow = typeof myWorkflow;

const WF: MyWorkflow = { name: "hello" };

export type CounterObject = typeof counter;
const Counter: CounterObject = { name: "counter" };
// restate server

restate.endpoint().bind(counter).bind(greeter).bind(myWorkflow).listen(9080);
