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

import { TerminalError } from "@restatedev/restate-sdk";

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

    async sleepConcurrently(
      ctx: restate.Context,
      millisDuration: number[]
    ): Promise<void> {
      const timers = millisDuration.map((duration) => ctx.sleep(duration));

      for (const timer of timers) {
        await timer;
      }
    },

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

    async cancelInvocation(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      ctx: restate.Context,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      invocationId: string
    ): Promise<void> {
      // TODO add cancel invocation here!
      return Promise.reject(new TerminalError("cancel is not supported yet"));
    },
  },
});

REGISTRY.addService(o);
