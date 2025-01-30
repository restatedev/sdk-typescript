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

import {
  service,
  endpoint,
  type Context,
  CombineablePromise,
} from "@restatedev/restate-sdk";
import { setTimeout } from "timers/promises";

const greeter = service({
  name: "greeter",
  handlers: {
    greet: async (ctx: Context, name: string) => {
      const { id, promise } = ctx.awakeable();
      console.log("Awakeable fuck u " + id);
      const p2 = ctx.sleep(110000);
      const p3 = ctx.run("stuff", async () => setTimeout(10000));
      await CombineablePromise.allSettled([promise, p2, p3]);
      await ctx.sleep(100000);
      return `Hello ${name}`;
    },
  },
});

export type Greeter = typeof greeter;

endpoint().bind(greeter).listen();
