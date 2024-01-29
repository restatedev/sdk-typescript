/*
 * Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

/* eslint-disable no-console */

/*
 * A simple example program using the Restate dynamic RPC-based API.
 *
 * This example primarily exists to make it simple to test the code against
 * a running Restate instance.
 */

import * as restate from "../src/public_api";

// handler implementations

const doGreet = async (
  ctx: restate.RpcContext,
  name: string
): Promise<string> => {
  const countSoFar = await ctx.rpc<apiType>({ path: "counter" }).count(name);

  const message = `Hello ${name}! at the ${countSoFar + 1}th time`;

  ctx.send(greeterApi).logger(message);
  ctx.sendDelayed(greeterApi, 100).logger("delayed " + message);

  return message;
};

const countKeeper = async (ctx: restate.RpcContext): Promise<number> => {
  const seen = (await ctx.get<number>("seen")) || 0;
  ctx.set("seen", seen + 1);
  return seen;
};

// routers (with some in-line handlers)

const greeter = restate.router({
  greet: doGreet,
  logger: async (ctx: restate.RpcContext, msg: string) => {
    ctx.console.log(" HEEEELLLLOOOOO! " + msg);
  },
});

const counter = restate.keyedRouter({
  count: countKeeper,
});

type apiType = typeof counter;
const greeterApi: restate.ServiceApi<typeof greeter> = { path: "greeter" };

// restate server

restate
  .createServer()
  .bindRouter("greeter", greeter)
  .bindKeyedRouter("counter", counter)
  .listen(9080);
