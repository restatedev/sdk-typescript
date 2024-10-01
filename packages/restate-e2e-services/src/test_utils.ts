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

import type { AwakeableHolder } from "./awakeable_holder.js";
import * as process from "node:process";
import { ListObject } from "./list.js";

const AwakeableHolder: AwakeableHolder = { name: "AwakeableHolder" };
const ListObject: ListObject = { name: "ListObject" };

type Command =
  | { type: "createAwakeableAndAwaitIt"; awakeableKey: string }
  | { type: "getEnvVariable"; envName: string };

interface InterpretRequest {
  listName: string;
  commands: Command[];
}

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

    async createAwakeableAndAwaitIt(
      ctx: restate.Context,
      req: { awakeableKey: string; awaitTimeout?: number }
    ): Promise<{ type: "timeout" } | { type: "result"; value: string }> {
      const { id, promise } = ctx.awakeable<string>();

      await ctx.objectClient(AwakeableHolder, req.awakeableKey).hold(id);

      if (!req.awaitTimeout) {
        return { type: "result", value: await promise };
      }

      try {
        const res = await promise.orTimeout(req.awaitTimeout);
        return { type: "result", value: res };
      } catch (e) {
        if (e instanceof restate.TimeoutError) {
          return { type: "timeout" };
        }
        throw e;
      }
    },

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

    async getEnvVariable(ctx: restate.Context, env: string): Promise<string> {
      return ctx.run(() => process.env[env] ?? "");
    },

    async interpretCommands(
      ctx: restate.Context,
      req: InterpretRequest
    ): Promise<void> {
      const listClient = ctx.objectSendClient(ListObject, req.listName);

      async function createAwakeableAndAwaitIt(
        awakeableKey: string
      ): Promise<string> {
        const { id, promise } = ctx.awakeable<string>();
        await ctx.objectClient(AwakeableHolder, awakeableKey).hold(id);
        return promise;
      }

      async function getEnvVariable(envName: string): Promise<string> {
        return ctx.run(() => process.env[envName] ?? "");
      }

      for (const command of req.commands) {
        switch (command.type) {
          case "createAwakeableAndAwaitIt":
            listClient.append(
              await createAwakeableAndAwaitIt(command.awakeableKey)
            );
            break;
          case "getEnvVariable":
            listClient.append(await getEnvVariable(command.envName));
            break;
        }
      }
    },
  },
});

REGISTRY.addObject(o);
