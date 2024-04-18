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

describe("HelloGreeter", () => {
  it("Demonstrates how to write a simple services", async () => {
    const myservice = restate.service({
      name: "myservice",
      handlers: {
        greet: async (ctx: restate.Context) => {
          return await ctx.run("greet", () => "hi there!");
        },
      },
    });

    restate.endpoint().bind(myservice);
    //---> 	.listen();
  });
});
