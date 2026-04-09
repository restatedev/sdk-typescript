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

import {
  service,
  serve,
  serde,
  internal,
  InvocationIdParser,
  createServiceHandler,
  type Context,
} from "@restatedev/restate-sdk";
import { z } from "zod";

const SignalPayload = z.object({
  value: z.string(),
});

const ResolveRequest = z.object({
  invocationId: z.string(),
  value: z.string(),
});

const signals = service({
  name: "signals",
  handlers: {
    wait: createServiceHandler(
      { input: serde.empty, output: serde.schema(SignalPayload) },
      async (ctx: Context) => {
        const ctxInternal = ctx as internal.ContextInternal;

        // Print the invocation ID so you can use it to send a signal
        ctx.console.log(`Invocation ID: ${ctx.request().id}`);

        // Wait for a signal named "mySignal"
        const payload = await ctxInternal.signal(
          "mySignal",
          serde.schema(SignalPayload)
        );

        return payload;
      }
    ),

    resolve: createServiceHandler(
      { input: serde.schema(ResolveRequest), output: serde.empty },
      async (ctx: Context, req) => {
        const ctxInternal = ctx as internal.ContextInternal;

        ctxInternal
          .invocation(InvocationIdParser.fromString(req.invocationId))
          .signal("mySignal", serde.schema(SignalPayload))
          .resolve({ value: req.value });
      }
    ),
  },
});

serve({ services: [signals] });
