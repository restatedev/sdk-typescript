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

// VirtualObjectCommandInterpreter — exercises a small command DSL
// against the SDK primitives (awakeables, sleep, run, await-any).
// Mirrors sdk-ruby/test-services/services/virtual_object_command_interpreter.rb.

import * as restate from "@restatedev/restate-sdk";
import {
  type Future,
  gen,
  execute,
  select,
  getState,
  setState,
  awakeable,
  sleep,
  run,
  resolveAwakeable,
  rejectAwakeable,
} from "@restatedev/restate-sdk-gen";

type AwaitAwakeableOrTimeoutCmd = {
  type: "awaitAwakeableOrTimeout";
  awakeableKey: string;
  timeoutMillis: number;
};
type ResolveAwakeableCmd = {
  type: "resolveAwakeable";
  awakeableKey: string;
  value: string;
};
type RejectAwakeableCmd = {
  type: "rejectAwakeable";
  awakeableKey: string;
  reason: string;
};
type GetEnvVarCmd = { type: "getEnvVariable"; envName: string };
type AwaitOneCmd = { type: "awaitOne"; command: SubCommand };
type AwaitAnyCmd = { type: "awaitAny"; commands: SubCommand[] };
type AwaitAnySuccessfulCmd = {
  type: "awaitAnySuccessful";
  commands: SubCommand[];
};

type Command =
  | AwaitAwakeableOrTimeoutCmd
  | ResolveAwakeableCmd
  | RejectAwakeableCmd
  | GetEnvVarCmd
  | AwaitOneCmd
  | AwaitAnyCmd
  | AwaitAnySuccessfulCmd;

type CreateAwakeableSub = { type: "createAwakeable"; awakeableKey: string };
type SleepSub = { type: "sleep"; timeoutMillis: number };
type RunThrowTerminalSub = {
  type: "runThrowTerminalException";
  reason: string;
};
type SubCommand = CreateAwakeableSub | SleepSub | RunThrowTerminalSub;

type SubFutureKind = "awakeable" | "sleep" | "run";
type SubEntry = { kind: SubFutureKind; future: Future<unknown> };

export const virtualObjectCommandInterpreter = restate.object({
  name: "VirtualObjectCommandInterpreter",
  handlers: {
    getResults: restate.handlers.object.shared(
      async (ctx: restate.ObjectSharedContext): Promise<string[]> =>
        execute(
          ctx,
          gen(function* () {
            return (yield* getState<string[]>("results")) ?? [];
          })
        )
    ),

    hasAwakeable: restate.handlers.object.shared(
      async (
        ctx: restate.ObjectSharedContext,
        awakeableKey: string
      ): Promise<boolean> =>
        execute(
          ctx,
          gen(function* () {
            const id = yield* getState<string>(`awk-${awakeableKey}`);
            return id != null;
          })
        )
    ),

    resolveAwakeable: restate.handlers.object.shared(
      async (
        ctx: restate.ObjectSharedContext,
        req: { awakeableKey: string; value: string }
      ): Promise<void> =>
        execute(
          ctx,
          gen(function* () {
            const id = yield* getState<string>(`awk-${req.awakeableKey}`);
            if (!id) {
              throw new restate.TerminalError("No awakeable is registered");
            }
            resolveAwakeable(id, req.value);
          })
        )
    ),

    rejectAwakeable: restate.handlers.object.shared(
      async (
        ctx: restate.ObjectSharedContext,
        req: { awakeableKey: string; reason: string }
      ): Promise<void> =>
        execute(
          ctx,
          gen(function* () {
            const id = yield* getState<string>(`awk-${req.awakeableKey}`);
            if (!id) {
              throw new restate.TerminalError("No awakeable is registered");
            }
            rejectAwakeable(id, req.reason);
          })
        )
    ),

    interpretCommands: async (
      ctx: restate.ObjectContext,
      req: { commands: Command[] }
    ): Promise<string> =>
      execute(
        ctx,
        gen(function* () {
          let result: string = "";

          function* createSub(
            cmd: SubCommand
          ): Generator<unknown, SubEntry, unknown> {
            switch (cmd.type) {
              case "createAwakeable": {
                const { id, promise } = awakeable<string>();
                setState(`awk-${cmd.awakeableKey}`, id);
                return { kind: "awakeable", future: promise };
              }
              case "sleep":
                return { kind: "sleep", future: sleep(cmd.timeoutMillis) };
              case "runThrowTerminalException":
                return {
                  kind: "run",
                  future: run(
                    async () => {
                      throw new restate.TerminalError(cmd.reason);
                    },
                    { name: "run should fail command" }
                  ),
                };
            }
          }

          function* awaitSub(
            kind: SubFutureKind,
            future: Future<unknown>
          ): Generator<unknown, string, unknown> {
            if (kind === "sleep") {
              yield* future;
              return "sleep";
            }
            const v = yield* future;
            return v as string;
          }

          for (const cmd of req.commands) {
            switch (cmd.type) {
              case "awaitAwakeableOrTimeout": {
                const { id, promise } = awakeable<string>();
                setState(`awk-${cmd.awakeableKey}`, id);
                const sleepFuture = sleep(cmd.timeoutMillis);
                const r = yield* select({
                  awk: promise,
                  sleep: sleepFuture,
                });
                if (r.tag === "awk") {
                  result = yield* r.future;
                } else {
                  yield* r.future;
                  throw new restate.TerminalError("await-timeout");
                }
                break;
              }
              case "resolveAwakeable": {
                const id = yield* getState<string>(`awk-${cmd.awakeableKey}`);
                if (!id) {
                  throw new restate.TerminalError("No awakeable is registered");
                }
                resolveAwakeable(id, cmd.value);
                result = "";
                break;
              }
              case "rejectAwakeable": {
                const id = yield* getState<string>(`awk-${cmd.awakeableKey}`);
                if (!id) {
                  throw new restate.TerminalError("No awakeable is registered");
                }
                rejectAwakeable(id, cmd.reason);
                result = "";
                break;
              }
              case "getEnvVariable": {
                result = yield* run(
                  async () => process.env[cmd.envName] ?? "",
                  { name: "get_env" }
                );
                break;
              }
              case "awaitOne": {
                const sub = yield* createSub(cmd.command);
                result = yield* awaitSub(sub.kind, sub.future);
                break;
              }
              case "awaitAny": {
                const subs: SubEntry[] = [];
                for (const c of cmd.commands) {
                  subs.push(yield* createSub(c));
                }
                const branches: Record<string, Future<unknown>> = {};
                subs.forEach((s, i) => {
                  branches[String(i)] = s.future;
                });
                const r = yield* select(branches);
                const winner = subs[Number(r.tag)]!;
                result = yield* awaitSub(winner.kind, winner.future);
                break;
              }
              case "awaitAnySuccessful": {
                const remaining: SubEntry[] = [];
                for (const c of cmd.commands) {
                  remaining.push(yield* createSub(c));
                }
                let found = false;
                while (remaining.length > 0) {
                  const branches: Record<string, Future<unknown>> = {};
                  remaining.forEach((s, i) => {
                    branches[String(i)] = s.future;
                  });
                  const r = yield* select(branches);
                  const idx = Number(r.tag);
                  const winner = remaining[idx]!;
                  try {
                    result = yield* awaitSub(winner.kind, winner.future);
                    found = true;
                    break;
                  } catch (e) {
                    if (e instanceof restate.TerminalError) {
                      remaining.splice(idx, 1);
                    } else {
                      throw e;
                    }
                  }
                }
                if (!found) {
                  throw new restate.TerminalError("All commands failed");
                }
                break;
              }
            }

            const last = (yield* getState<string[]>("results")) ?? [];
            setState("results", [...last, result]);
          }

          return result;
        })
      ),
  },
});
