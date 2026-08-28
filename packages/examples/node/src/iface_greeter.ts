/*
 * Copyright (c) 2023-2026 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

import * as restate from "@restatedev/restate-sdk/node";
import { connect } from "@restatedev/restate-sdk-clients";
import { z } from "zod";

// 1. The service interface (contract)

const Greeting = z.object({ name: z.string() });
const GreetingResponse = z.object({ result: z.string() });

export const greeterInterface = restate.iface.service("greeter", {
  greet: restate.iface.schemas({ input: Greeting, output: GreetingResponse }),
  ping: restate.iface.json<void, string>(),
});

// 2. The implementation

const greeter = restate.implement(greeterInterface, {
  handlers: {
    greet: async (_ctx, { name }) => ({ result: `Hello, ${name}!` }),
    ping: async (_ctx) => "pong",
  },
});

// 3. A service that CALLS greeter through the interface.

const frontend = restate.service({
  name: "frontend",
  handlers: {
    hello: async (ctx, name: string) => {
      const client = ctx.client(greeterInterface);
      const { result } = await client.greet({ name });
      return result;
    },
  },
});

void restate.serve({
  services: [greeter, frontend],
  port: 9080,
});

// 4. Calling greeter from OUTSIDE Restate (ingress).

export async function callFromIngress(name: string) {
  const ingress = connect({ url: "http://localhost:8080" });

  const { result } = await ingress.client(greeterInterface).greet({
    name,
  });

  console.log(result);
}
