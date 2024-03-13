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

import * as restate from "../src/public_api";

const greeter = restate.service("greeter", {
  greet: async (ctx: restate.Context, name: string) => {
    // blocking RPC call to a keyed service (here supplying type and path separately)
    const countSoFar = await ctx.object(Counter, name).count();

    const message = `Hello ${name}, for the ${countSoFar + 1}th time!`;

    // sending messages to ourselves, immediately and delayed
    ctx.serviceSend(Greeter).logger(message);
    ctx.serviceSendDelayed(Greeter, 100).logger("delayed " + message);

    return message;
  },

  logger: async (ctx: restate.Context, msg: string) => {
    ctx.console.log(" HEEEELLLLOOOOO! " + msg);
  },
});

export type GreeterService = typeof greeter;
const Greeter: GreeterService = { path: "greeter" };

//
// The stateful aux service that keeps the counts.
// This could in principle be the same service as the greet service, we just separate
// them here to have this multi-service setup for testing.
//

const counter = restate.object("counter", {
  count: async (ctx: restate.ObjectContext): Promise<number> => {
    const seen = (await ctx.get<number>("seen")) ?? 0;
    ctx.set("seen", seen + 1);
    return seen;
  },
});

export type CounterObject = typeof counter;
const Counter: CounterObject = { path: "counter" };
// restate server

restate.endpoint().object(counter).service(greeter).listen(9080);
