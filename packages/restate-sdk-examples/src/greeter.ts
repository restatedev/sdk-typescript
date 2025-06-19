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

import { service, endpoint, type Context, RestatePromise } from "@restatedev/restate-sdk";

const greeter = service({
  name: "greeter",
  handlers: {
    greet: async (ctx: Context, name: string) => {
      return `Hello ${name}`;
    },

    async foo(ctx: Context) {
      await RestatePromise.all([
        ctx.run(
            "my-side-effect-with-failure",
            () =>
                new Promise((r, e) =>
                    setTimeout(() => {
                      e(new Error("something wrong really coming from the SDK"));
                    }, 100)
                )
        ),
        ctx.run(
            "my-side-effect-with-success",
            () =>
                new Promise((r, e) =>
                    setTimeout(() => {
                      r("some-value");
                    }, 20000)
                )
        ),
      ]);

      return true;
    }
  },
});

export type Greeter = typeof greeter;

endpoint().bind(greeter).listen();
