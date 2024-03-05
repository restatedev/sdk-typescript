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

const greeter = restate.service({
  greet: async (ctx: restate.Context, name: string) => {
    // blocking RPC call to a keyed service (here supplying type and path separately)
    const countSoFar = await ctx.object(counterApi, name).count();

    const message = `Hello ${name}, for the ${countSoFar + 1}th time!`;

    // sending messages to ourselves, immediately and delayed
    ctx.serviceSend(greeterApi).logger(message);
    ctx.serviceSendDelayed(greeterApi, 100).logger("delayed " + message);

    return message;
  },

  logger: async (ctx: restate.Context, msg: string) => {
    ctx.console.log(" HEEEELLLLOOOOO! " + msg);
  },
});

//
// The stateful aux service that keeps the counts.
// This could in principle be the same service as the greet service, we just separate
// them here to have this multi-service setup for testing.
//
const counter = restate.object({
  count: async (ctx: restate.ObjectContext): Promise<number> => {
    const seen = (await ctx.get<number>("seen")) ?? 0;
    ctx.set("seen", seen + 1);
    return seen;
  },
});

const greeterApi = restate.serviceApi("greeter", greeter);
const counterApi = restate.objectApi("counter", counter);

// restate server

restate
  .endpoint()
  .service(greeterApi.path, greeter)
  .object(counterApi.path, counter)
  .listen(9080);
