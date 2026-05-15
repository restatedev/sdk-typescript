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

import * as restate from "@restatedev/restate-sdk";
import {
  type Future,
  object,
  select,
  state,
  sharedState,
  awakeable,
  sleep,
  run,
  signal,
  resolveAwakeable,
  rejectAwakeable,
  all,
  allSettled,
  any,
  race,
  spawn,
  gen,
} from "@restatedev/restate-sdk-gen";
import { setTimeout } from "node:timers/promises";

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
type AwaitFirstSucceededOrAllFailedCmd = {
  type: "awaitFirstSucceededOrAllFailed";
  commands: SubCommand[];
};
type AwaitFirstCompletedCmd = {
  type: "awaitFirstCompleted";
  commands: SubCommand[];
};
type AwaitAllSucceededOrFirstFailedCmd = {
  type: "awaitAllSucceededOrFirstFailed";
  commands: SubCommand[];
};
type AwaitAllCompletedCmd = {
  type: "awaitAllCompleted";
  commands: SubCommand[];
};

type Command =
  | AwaitAwakeableOrTimeoutCmd
  | ResolveAwakeableCmd
  | RejectAwakeableCmd
  | GetEnvVarCmd
  | AwaitOneCmd
  | AwaitAnyCmd
  | AwaitAnySuccessfulCmd
  | AwaitFirstSucceededOrAllFailedCmd
  | AwaitFirstCompletedCmd
  | AwaitAllSucceededOrFirstFailedCmd
  | AwaitAllCompletedCmd;

type CreateAwakeableSub = { type: "createAwakeable"; awakeableKey: string };
type SleepSub = { type: "sleep"; timeoutMillis: number };
type RunReturnsSub = { type: "runReturns"; value: string };
type RunThrowTerminalSub = {
  type: "runThrowTerminalException";
  reason: string;
};
type CreateSignalSub = { type: "createSignal"; signalName: string };
type SubCommand =
  | CreateAwakeableSub
  | SleepSub
  | RunReturnsSub
  | RunThrowTerminalSub
  | CreateSignalSub;

type State = { results: string[]; [k: `awk-${string}`]: string };

type SubFutureKind = "awakeable" | "sleep" | "run";
type SubEntry = { kind: SubFutureKind; future: Future<string> };

export const virtualObjectCommandInterpreter = object({
  name: "VirtualObjectCommandInterpreter",
  handlers: {
    *getResults() {
      return (yield* sharedState<State>().get("results")) ?? [];
    },

    *hasAwakeable(awakeableKey: string) {
      const id = yield* sharedState<State>().get(`awk-${awakeableKey}`);
      return id != null;
    },

    *resolveAwakeable(req: { awakeableKey: string; value: string }) {
      const id = yield* sharedState<State>().get(`awk-${req.awakeableKey}`);
      if (!id) throw new restate.TerminalError("No awakeable is registered");
      resolveAwakeable(id, req.value);
    },

    *rejectAwakeable(req: { awakeableKey: string; reason: string }) {
      const id = yield* sharedState<State>().get(`awk-${req.awakeableKey}`);
      if (!id) throw new restate.TerminalError("No awakeable is registered");
      rejectAwakeable(id, req.reason);
    },

    *interpretCommands(req: { commands: Command[] }) {
      let result = "";

      function* createSub(
        cmd: SubCommand
      ): Generator<unknown, SubEntry, unknown> {
        switch (cmd.type) {
          case "createAwakeable": {
            const { id, promise } = awakeable<string>();
            state<State>().set(`awk-${cmd.awakeableKey}`, id);
            return { kind: "awakeable", future: promise };
          }
          case "sleep":
            return {
              kind: "sleep",
              future: spawn(
                gen(function* () {
                  yield* sleep(cmd.timeoutMillis);
                  return "sleep";
                })
              ),
            };
          case "runReturns":
            return {
              kind: "run",
              future: run(
                async () => {
                  await setTimeout(1);
                  return cmd.value;
                },
                { name: "runReturns" }
              ),
            };
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
          case "createSignal":
            return {
              kind: "awakeable",
              future: signal<string>(cmd.signalName),
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
        return (yield* future) as string;
      }

      for (const cmd of req.commands) {
        switch (cmd.type) {
          case "awaitAwakeableOrTimeout": {
            const { id, promise } = awakeable<string>();
            state<State>().set(`awk-${cmd.awakeableKey}`, id);
            const sleepFuture = sleep(cmd.timeoutMillis);
            const r = yield* select({ awk: promise, sleep: sleepFuture });
            if (r.tag === "awk") {
              result = (yield* r.future) as unknown as string;
            } else {
              yield* r.future;
              throw new restate.TerminalError("await-timeout");
            }
            break;
          }
          case "resolveAwakeable": {
            const id = yield* state<State>().get(`awk-${cmd.awakeableKey}`);
            if (!id)
              throw new restate.TerminalError("No awakeable is registered");
            resolveAwakeable(id, cmd.value);
            result = "";
            break;
          }
          case "rejectAwakeable": {
            const id = yield* state<State>().get(`awk-${cmd.awakeableKey}`);
            if (!id)
              throw new restate.TerminalError("No awakeable is registered");
            rejectAwakeable(id, cmd.reason);
            result = "";
            break;
          }
          case "getEnvVariable":
            result = yield* run(async () => process.env[cmd.envName] ?? "", {
              name: "get_env",
            });
            break;
          case "awaitOne": {
            const sub = yield* createSub(cmd.command);
            result = yield* awaitSub(sub.kind, sub.future);
            break;
          }
          case "awaitAny": {
            const subs: SubEntry[] = [];
            for (const c of cmd.commands) subs.push(yield* createSub(c));
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
            for (const c of cmd.commands) remaining.push(yield* createSub(c));
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
                if (e instanceof restate.TerminalError)
                  remaining.splice(idx, 1);
                else throw e;
              }
            }
            if (!found) throw new restate.TerminalError("All commands failed");
            break;
          }
          case "awaitFirstSucceededOrAllFailed": {
            const subs: SubEntry[] = [];
            for (const c of cmd.commands) subs.push(yield* createSub(c));
            // any() rejects only when ALL fail; first success wins.
            result = yield* any(subs.map((s) => s.future));
            break;
          }
          case "awaitFirstCompleted": {
            const subs: SubEntry[] = [];
            for (const c of cmd.commands) subs.push(yield* createSub(c));
            // race() settles with the first future to complete.
            result = yield* race(subs.map((s) => s.future));
            break;
          }
          case "awaitAllSucceededOrFirstFailed": {
            const subs: SubEntry[] = [];
            for (const c of cmd.commands) subs.push(yield* createSub(c));
            const results = yield* all(subs.map((s) => s.future));
            result = results.join("|");
            break;
          }
          case "awaitAllCompleted": {
            const subs: SubEntry[] = [];
            for (const c of cmd.commands) subs.push(yield* createSub(c));
            const settled = yield* allSettled(subs.map((s) => s.future));
            result = settled
              .map((r) =>
                r.status === "rejected"
                  ? `err:${(r.reason as Error).message}`
                  : `ok:${r.value}`
              )
              .join("|");
            break;
          }
        }
        const last = (yield* state<State>().get("results")) ?? [];
        state<State>().set("results", [...last, result]);
      }
      return result;
    },
  },
  options: {
    handlers: {
      getResults: { shared: true },
      hasAwakeable: { shared: true },
      resolveAwakeable: { shared: true },
      rejectAwakeable: { shared: true },
    },
  },
});
