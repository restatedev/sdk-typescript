import * as restate from "@restatedev/restate-sdk/fetch";
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

const identityKeys =
  process.env.RESTATE_IDENTITY_KEYS?.split(",").filter(Boolean);

Bun.serve({
  fetch: restate.createEndpointHandler({ services: [greeter], identityKeys }),
  port: 9080,
});
