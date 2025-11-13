/*
 * Copyright (c) 2024 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate examples,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in the file LICENSE
 * in the root directory of this repository or package or at
 * https://github.com/restatedev/examples/
 */

import * as restate from "@restatedev/restate-sdk/lambda";
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
        // Respond to caller
        return { result: `You said hi to ${name}!` };
      }
    ),
  },
});

export const handler = restate.createEndpointHandler({
  services: [greeter],
});
