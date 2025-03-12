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
import { serde } from "@restatedev/restate-sdk-zod";
import { z } from "zod";

const Greeting = z.object({
  name: z.string(),
});

const greeter = restate.service({
  name: "greeter",
  handlers: {
    greet: restate.handlers.handler(
      {
        input: serde.zod(Greeting),
        output: serde.zod(z.string()),
      },
      async (ctx, greeting) => {
        return `Hello ${greeting.name}!`;
      }
    ),
  },
});

export type Greeter = typeof greeter;

restate.endpoint().bind(greeter).listen();
