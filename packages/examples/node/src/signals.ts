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
import * as restate from "@restatedev/restate-sdk";

const SignalPayload = z.object({
  value: z.string(),
});

const ResolveRequest = z.object({
  invocationId: z.string(),
  signal: z.string(),
  value: z.string(),
});

const signals = service({
  name: "signals",
  options: {
    inactivityTimeout: 0,
  },
  handlers: {
    wait: async (ctx: Context) => {
      const ctxInternal = ctx as restate.internal.ContextInternal;
      const p1 = ctxInternal.signal<string>("p1");
      const p2 = ctxInternal.signal<string>("p2");
      const p3 = ctxInternal.signal<string>("p3");
      return await restate.RestatePromise.all([p1, p2, p3]);
    },

    resolve: createServiceHandler(
      { input: serde.schema(ResolveRequest), output: serde.empty },
      async (ctx: Context, req) => {
        const ctxInternal = ctx as internal.ContextInternal;

        ctxInternal
          .invocation(InvocationIdParser.fromString(req.invocationId))
          .signal(req.signal, serde.schema(SignalPayload))
          .resolve({ value: req.value });
      }
    ),

    reject: createServiceHandler(
      { input: serde.schema(ResolveRequest), output: serde.empty },
      async (ctx: Context, req) => {
        const ctxInternal = ctx as internal.ContextInternal;

        ctxInternal
          .invocation(InvocationIdParser.fromString(req.invocationId))
          .signal(req.signal, serde.schema(SignalPayload))
          .reject(req.value);
      }
    ),
  },
});

serve({ services: [signals] });
