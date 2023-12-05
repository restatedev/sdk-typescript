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

class MyCounter {
  async increment(ctx: restate.RpcContext): Promise<number> {
    const seen = (await ctx.get<number>("seen")) || 0;
    ctx.set("seen", seen + 1);
    // Free form compensation, can register for everything
    ctx.registerCompensation(async () => ctx.set("seen", seen - 1));
    return seen;
  }

  async decrement(ctx: restate.RpcContext): Promise<number> {
    const seen = (await ctx.get<number>("seen")) || 0;
    if (seen > 0) {
      ctx.set("seen", seen - 1);
      ctx.registerCompensation(async () => ctx.set("seen", seen + 1));
    }
    return seen;
  }
}

class MyGreeter {
  async greet(ctx: restate.RpcContext, name: string): Promise<string> {
    // Compensation on promise
    const countSoFar = await ctx.registerPromiseCompensation(
      ctx.rpc(counterApi).increment(name),
      async () => ctx.send(counterApi).decrement(name)
    );

    // Or

    const countSoFar = await ctx
      .rpc(counterApi)
      .increment(name)
      // Shortcut for ctx.registerPromiseCompensation (this won't work for grpc generated clients?)
      .withCompensation(async () => ctx.send(counterApi).decrement(name));

    const message = `Hello ${name}! at the ${countSoFar + 1}th time`;

    // Compensation on side effect (you can't register compensations using registerPromiseCompensation b/c they won't get executed in some corner cases!)
    ctx.compensatedSideEffect(
      async () => console.log(message),
      async () =>
        console.log("Compensating side effect, which was succesfully executed"),
      async () =>
        console.log(
          "Compensating side effect, which was rejected or not executed"
        )
    );

    return message;
  }
}

// routers (with some in-line handlers)

const counter = restate.keyedRouter(new MyCounter());
const counterApi: restate.ServiceApi<typeof counter> = { path: "counter" };
const greeter = restate.router(new MyGreeter());
const greeterApi: restate.ServiceApi<typeof greeter> = { path: "greeter" };

// restate server

restate
  .createServer()
  .bindRouter("greeter", greeter)
  .bindKeyedRouter("counter", counter)
  .listen(9080);
