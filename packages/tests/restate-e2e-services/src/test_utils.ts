// Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
//
// This file is part of the Restate e2e tests,
// which are released under the MIT license.
//
// You can find a copy of the license in file LICENSE in the root
// directory of this repository or package, or at
// https://github.com/restatedev/e2e/blob/main/LICENSE

import * as restate from "@restatedev/restate-sdk";
import { REGISTRY } from "./services.js";

const o = restate.service({
  name: "TestUtilsService",
  handlers: {
    echo(ctx: restate.Context, input: string): Promise<string> {
      return Promise.resolve(input);
    },

    uppercaseEcho(ctx: restate.Context, input: string): Promise<string> {
      ctx.console.log("uppercaseEcho called with", input);
      return Promise.resolve(input.toUpperCase());
    },

    echoHeaders(ctx: restate.Context): Promise<{ [key: string]: string }> {
      return Promise.resolve(
        Object.fromEntries(ctx.request().headers.entries())
      );
    },

    rawEcho: restate.handlers.handler(
      { input: restate.serde.binary, output: restate.serde.binary },
      (ctx: restate.Context, input: Uint8Array) => {
        return Promise.resolve(input);
      }
    ),

    async countExecutedSideEffects(
      ctx: restate.Context,
      increments: number
    ): Promise<number> {
      let invokedSideEffects = 0;

      const effect = () => {
        invokedSideEffects++;
      };

      for (let i = 0; i < increments; i++) {
        await ctx.run("count", effect);
      }

      return invokedSideEffects;
    },

    cancelInvocation(
      ctx: restate.Context,
      invocationId: string
    ): Promise<void> {
      const id = restate.InvocationIdParser.fromString(invocationId);
      ctx.cancel(id);
      return Promise.resolve();
    },

    resolveSignal(
      ctx: restate.Context,
      req: { invocationId: string; signalName: string; value: string }
    ): Promise<void> {
      const ctxInternal = ctx as unknown as restate.internal.ContextInternal;
      ctxInternal
        .invocation(restate.InvocationIdParser.fromString(req.invocationId))
        .signal(req.signalName)
        .resolve(req.value);
      return Promise.resolve();
    },

    rejectSignal(
      ctx: restate.Context,
      req: { invocationId: string; signalName: string; reason: string }
    ): Promise<void> {
      const ctxInternal = ctx as unknown as restate.internal.ContextInternal;
      ctxInternal
        .invocation(restate.InvocationIdParser.fromString(req.invocationId))
        .signal(req.signalName)
        .reject(req.reason);
      return Promise.resolve();
    },
  },
});

REGISTRY.addService(o);
