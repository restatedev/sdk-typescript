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

import * as restate from "@restatedev/restate-sdk/node";
import { serde } from "@restatedev/restate-sdk-zod";

import { z } from "zod";

const Greeting = z.object({
  name: z.string(),
});

const GreetingResponse = z.object({
  result: z.string(),
});

const greeter = restate.service({
  name: "Greeter",
  handlers: {
    greet: restate.createServiceHandler(
      { input: serde.zod(Greeting), output: serde.zod(GreetingResponse) },
      async (ctx: restate.Context, { name }) => {
        return { result: `You said hi to ${name}!` };
      }
    ),
  },
});

void restate.serve({
  services: [greeter],
  port: 9080,
});
