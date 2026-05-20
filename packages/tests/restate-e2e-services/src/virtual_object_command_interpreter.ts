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

import { setTimeout } from "node:timers/promises";
import * as process from "node:process";
import type { ObjectContext } from "@restatedev/restate-sdk";
import { RestatePromise, TerminalError } from "@restatedev/restate-sdk";

type AwaitableCommand =
  | CreateAwakeable
  | Sleep
  | RunReturns
  | RunThrowTerminalException
  | CreateSignal;

interface CreateAwakeable {
  type: "createAwakeable";
  awakeableKey: string;
}

interface Sleep {
  type: "sleep";
  timeoutMillis: number;
}

interface RunReturns {
  type: "runReturns";
  value: string;
}

interface RunThrowTerminalException {
  type: "runThrowTerminalException";
  reason: string;
}

interface CreateSignal {
  type: "createSignal";
  signalName: string;
}

type Command =
  | AwaitAnySuccessful
  | AwaitAny
  | AwaitOne
  | AwaitAwakeableOrTimeout
  | AwaitFirstSucceededOrAllFailed
  | AwaitFirstCompleted
  | AwaitAllSucceededOrFirstFailed
  | AwaitAllCompleted
  | ResolveAwakeable
  | RejectAwakeable
  | GetEnvVariable;

interface AwaitAnySuccessful {
  type: "awaitAnySuccessful";
  commands: AwaitableCommand[];
}

interface AwaitAny {
  type: "awaitAny";
  commands: AwaitableCommand[];
}

interface AwaitOne {
  type: "awaitOne";
  command: AwaitableCommand;
}

interface AwaitAwakeableOrTimeout {
  type: "awaitAwakeableOrTimeout";
  awakeableKey: string;
  timeoutMillis: number;
}

interface AwaitFirstSucceededOrAllFailed {
  type: "awaitFirstSucceededOrAllFailed";
  commands: AwaitableCommand[];
}

interface AwaitFirstCompleted {
  type: "awaitFirstCompleted";
  commands: AwaitableCommand[];
}

interface AwaitAllSucceededOrFirstFailed {
  type: "awaitAllSucceededOrFirstFailed";
  commands: AwaitableCommand[];
}

interface AwaitAllCompleted {
  type: "awaitAllCompleted";
  commands: AwaitableCommand[];
}

interface ResolveAwakeable {
  type: "resolveAwakeable";
  awakeableKey: string;
  value: string;
}

interface RejectAwakeable {
  type: "rejectAwakeable";
  awakeableKey: string;
  reason: string;
}

interface GetEnvVariable {
  type: "getEnvVariable";
  envName: string;
}

interface InterpretRequest {
  commands: Command[];
}

function createAwakeable(ctx: ObjectContext, awakeableKey: string) {
  const { id, promise } = ctx.awakeable<string>();
  ctx.set(`awk-${awakeableKey}`, id);
  return promise;
}

function parseAwaitableCommand(
  ctx: ObjectContext,
  command: AwaitableCommand
): RestatePromise<string> {
  switch (command.type) {
    case "createAwakeable":
      return createAwakeable(ctx, command.awakeableKey);
    case "sleep":
      return ctx.sleep(command.timeoutMillis).map(() => "sleep");
    case "runReturns":
      return ctx.run<string>(async () => {
        await setTimeout(1);
        return command.value;
      });
    case "runThrowTerminalException":
      return ctx.run<string>(() => {
        throw new TerminalError(command.reason);
      });
    case "createSignal": {
      return ctx.signal<string>(command.signalName);
    }
  }
}

async function awaitAwakeableOrTimeout(
  ctx: ObjectContext,
  {
    awakeableKey,
    timeoutMillis,
  }: { awakeableKey: string; timeoutMillis: number }
): Promise<string> {
  const promise = createAwakeable(ctx, awakeableKey);
  try {
    return await promise.orTimeout(timeoutMillis);
  } catch (e) {
    if (e instanceof restate.TimeoutError) {
      throw new TerminalError("await-timeout");
    }
    throw e;
  }
}

async function getEnvVariable(
  ctx: restate.Context,
  envName: string
): Promise<string> {
  return ctx.run(() => process.env[envName] ?? "");
}

async function resolveAwakeable(
  ctx: restate.ObjectSharedContext,
  {
    awakeableKey,
    value,
  }: {
    awakeableKey: string;
    value: string;
  }
) {
  const awkId = await ctx.get<string>(`awk-${awakeableKey}`);
  if (awkId === null) {
    throw new TerminalError("awakeable is not registered yet");
  }
  ctx.resolveAwakeable(awkId, value);
}

async function rejectAwakeable(
  ctx: restate.ObjectSharedContext,
  {
    awakeableKey,
    reason,
  }: {
    awakeableKey: string;
    reason: string;
  }
) {
  const awkId = await ctx.get<string>(`awk-${awakeableKey}`);
  if (awkId === null) {
    throw new TerminalError("awakeable is not registered yet");
  }
  ctx.rejectAwakeable(awkId, reason);
}

const virtualObjectCommandInterpreter = restate.object({
  name: "VirtualObjectCommandInterpreter",
  handlers: {
    interpretCommands: restate.handlers.object.exclusive(
      async (ctx: restate.ObjectContext, req: InterpretRequest) => {
        let lastResult = "";

        for (const command of req.commands) {
          switch (command.type) {
            case "awaitAnySuccessful":
              lastResult = await RestatePromise.any(
                command.commands.map((cmd) => parseAwaitableCommand(ctx, cmd))
              );
              break;
            case "awaitAny":
              lastResult = await RestatePromise.race(
                command.commands.map((cmd) => parseAwaitableCommand(ctx, cmd))
              );
              break;
            case "awaitOne":
              lastResult = await parseAwaitableCommand(ctx, command.command);
              break;
            case "awaitAwakeableOrTimeout":
              lastResult = await awaitAwakeableOrTimeout(ctx, {
                awakeableKey: command.awakeableKey,
                timeoutMillis: command.timeoutMillis,
              });
              break;
            case "awaitFirstSucceededOrAllFailed":
              lastResult = await RestatePromise.any(
                command.commands.map((cmd) => parseAwaitableCommand(ctx, cmd))
              );
              break;
            case "awaitFirstCompleted":
              lastResult = await RestatePromise.race(
                command.commands.map((cmd) => parseAwaitableCommand(ctx, cmd))
              );
              break;
            case "awaitAllSucceededOrFirstFailed": {
              const results = await RestatePromise.all(
                command.commands.map((cmd) => parseAwaitableCommand(ctx, cmd))
              );
              lastResult = results.join("|");
              break;
            }
            case "awaitAllCompleted": {
              const settled = await RestatePromise.allSettled(
                command.commands.map((cmd) => parseAwaitableCommand(ctx, cmd))
              );
              lastResult = settled
                .map((r) =>
                  r.status === "fulfilled"
                    ? `ok:${r.value}`
                    : `err:${(r.reason as Error).message}`
                )
                .join("|");
              break;
            }
            case "resolveAwakeable":
              await resolveAwakeable(ctx, {
                awakeableKey: command.awakeableKey,
                value: command.value,
              });
              lastResult = "";
              break;
            case "rejectAwakeable":
              await rejectAwakeable(ctx, {
                awakeableKey: command.awakeableKey,
                reason: command.reason,
              });
              lastResult = "";
              break;
            case "getEnvVariable":
              lastResult = await getEnvVariable(ctx, command.envName);
              break;
          }

          // Append result
          const results = (await ctx.get<string[]>("results")) ?? [];
          results.push(lastResult);
          ctx.set("results", results);
        }

        return lastResult;
      }
    ),

    resolveAwakeable: restate.handlers.object.shared(resolveAwakeable),

    rejectAwakeable: restate.handlers.object.shared(rejectAwakeable),

    hasAwakeable: restate.handlers.object.shared(
      async (ctx: restate.ObjectSharedContext, awakeableKey: string) => {
        return (await ctx.get<string>(`awk-${awakeableKey}`)) !== null;
      }
    ),

    getResults: restate.handlers.object.shared(
      async (ctx: restate.ObjectSharedContext) => {
        return (await ctx.get<string[]>("results")) ?? [];
      }
    ),
  },
});

REGISTRY.addObject(virtualObjectCommandInterpreter);
