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

import { service, endpoint, type Context } from "@restatedev/restate-sdk";

const greeter = service({
  name: "greeter",
  handlers: {
    greet: async (ctx: Context, name: string) => {
      const { id, promise } = ctx.awakeable<string>();

      ctx.console.log(
        `curl -X POST http://localhost:8080/restate/awakeables/${id}/resolve --json '"Guardiani"'`
      );

      const surnameProm = promise.orTimeout(1000 * 10);

      return `Hello ${name} ${await surnameProm}`;
    },
  },
});

export type Greeter = typeof greeter;

endpoint().bind(greeter).listen();
