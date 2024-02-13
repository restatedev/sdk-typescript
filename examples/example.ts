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
 * A simple example program using the Restate dynamic RPC-based API.
 *
 * This example primarily exists to make it simple to test the code against
 * a running Restate instance.
 */

import * as restate from "../src/public_api";

//
// The main entry point for the service, receiving the greeting request and name.
//
const greeter = restate.router({
  greet: async (ctx: restate.Context, name: string) => {
    // blocking RPC call to a keyed service (here supplying type and path separately)
    const countSoFar = await ctx
      .rpc<counterApiType>({ path: "counter" })
      .count(name);

    const message = `Hello ${name}, for the ${countSoFar + 1}th time!`;

    // sending messages to ourselves, immediately and delayed
    ctx.send(greeterApi).logger(message);
    ctx.sendDelayed(greeterApi, 100).logger("delayed " + message);

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
const counter = restate.keyedRouter({
  count: async (ctx: restate.KeyedContext): Promise<number> => {
    const seen = (await ctx.get<number>("seen")) ?? 0;
    ctx.set("seen", seen + 1);
    return seen;
  },
});

const greeterApi: restate.ServiceApi<typeof greeter> = { path: "greeter" };
type counterApiType = typeof counter;

// restate server

restate
  .createServer()
  .bindRouter("greeter", greeter)
  .bindKeyedRouter("counter", counter)
  .listen(9080);
