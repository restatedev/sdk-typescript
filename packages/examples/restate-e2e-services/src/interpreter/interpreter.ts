// Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
//
// This file is part of the Restate e2e tests,
// which are released under the MIT license.
//
// You can find a copy of the license in file LICENSE in the root
// directory of this repository or package, or at
// https://github.com/restatedev/e2e/blob/main/LICENSE

import * as restate from "@restatedev/restate-sdk";
import { CommandType, type Program } from "./commands.js";
import type { ServiceInterpreterHelper as Service } from "./services.js";

export type InterpreterId = {
  readonly layer: number;
  readonly key: string;
};

export const interpreterObjectForLayer = (
  layer: number
): restate.VirtualObjectDefinition<string, InterpreterObject> => {
  const name = `ObjectInterpreterL${layer}`;
  return { name };
};

export const createInterpreterObject = (layer: number) => {
  const name = `ObjectInterpreterL${layer}`;

  const handlers: InterpreterObject = {
    counter: async (ctx: restate.ObjectContext): Promise<number> => {
      return (await ctx.get(STATE_COUNTER_NAME)) ?? 0;
    },

    interpret: (
      ctx: restate.ObjectContext,
      program: Program
    ): Promise<void> => {
      return ProgramInterpreter.from(layer, ctx).interpret(program);
    },
  };

  return restate.object({ name, handlers });
};

interface InterpreterObject {
  counter(ctx: restate.ObjectContext): Promise<number>;
  interpret(ctx: restate.ObjectContext, program: Program): Promise<void>;
}

/**
 * Represents a promise to be awaited on.
 * we delay *any* chaining to the promise as close as possible
 * to the moment that promise is being awaited, because sometimes chaining
 * might actually create a side effect (for example trigger a suspension timer).
 *
 * There is also an expected value to verify that the result of the promise strictly matches to the expected value.
 */
type Await = {
  readonly expected?: string;
  readonly thunk: () => Promise<string> | Promise<void>;
};

const Service: Service = { name: "ServiceInterpreterHelper" };
const STATE_COUNTER_NAME = "counter";

class ProgramInterpreter {
  public static from(
    layer: number,
    ctx: restate.ObjectContext
  ): ProgramInterpreter {
    const id = { layer, key: ctx.key };
    return new ProgramInterpreter(ctx, id);
  }

  constructor(
    private readonly ctx: restate.ObjectContext,
    private readonly interpreterId: InterpreterId
  ) {}

  async interpret(program: Program): Promise<void> {
    const ctx = this.ctx;
    const promises = new Map<number, Await>();
    const commands = program.commands;
    for (let i = 0; i < commands.length; i++) {
      const command = commands[i];
      switch (command?.kind) {
        case CommandType.SET_STATE: {
          ctx.set(`key-${command.key}`, `value-${command.key}`);
          break;
        }
        case CommandType.GET_STATE: {
          await ctx.get(`key-${command.key}`);
          break;
        }
        case CommandType.CLEAR_STATE: {
          ctx.clear(`key-${command.key}`);
          break;
        }
        case CommandType.INCREMENT_STATE_COUNTER: {
          const counter = (await ctx.get<number>(STATE_COUNTER_NAME)) ?? 0;
          ctx.set(STATE_COUNTER_NAME, counter + 1);
          break;
        }
        case CommandType.SLEEP: {
          await ctx.sleep(command.duration);
          break;
        }
        case CommandType.CALL_SERVICE: {
          const expected = `hello-${i}`;
          const promise = ctx.serviceClient(Service).echo(expected);
          promises.set(i, {
            thunk: () => promise,
            expected,
          });
          break;
        }
        case CommandType.INCREMENT_VIA_DELAYED_CALL: {
          ctx
            .serviceSendClient(Service)
            .incrementIndirectly(
              this.interpreterId,
              restate.rpc.sendOpts({ delay: command.duration })
            );
          break;
        }
        case CommandType.CALL_SLOW_SERVICE: {
          const expected = `hello-${i}`;
          const promise = ctx.serviceClient(Service).echoLater({
            sleep: command.sleep,
            parameter: expected,
          });
          promises.set(i, {
            thunk: () => promise,
            expected,
          });
          break;
        }
        case CommandType.SIDE_EFFECT: {
          const expected = `hello-${i}`;
          const result = await ctx.run(() => expected);
          if (result !== expected) {
            throw new restate.TerminalError(
              `RPC failure ${result} != ${expected}`
            );
          }
          break;
        }
        case CommandType.SLOW_SIDE_EFFECT: {
          await ctx.run(
            () =>
              new Promise((resolve) => {
                setTimeout(resolve, 1);
              })
          );
          break;
        }
        case CommandType.RECOVER_TERMINAL_CALL: {
          const promise = ctx.serviceClient(Service).terminalFailure();
          let caught = false;
          try {
            await promise;
          } catch (e) {
            if (e instanceof restate.TerminalError) {
              caught = true;
            }
          }
          if (!caught) {
            throw new restate.TerminalError(
              `Test assertion failed, was expected to get a terminal error.`
            );
          }
          break;
        }
        case CommandType.RECOVER_TERMINAL_MAYBE_UN_AWAITED: {
          const promise = ctx
            .serviceClient(Service)
            .terminalFailure()
            .map((_v, f) => {
              if (f) {
                return "terminal";
              } else {
                throw new restate.TerminalError("unexpectedly succeeded");
              }
            });
          promises.set(i, {
            thunk: () => promise,
            expected: "terminal",
          });
          break;
        }
        case CommandType.THROWING_SIDE_EFFECT: {
          await ctx.run(() => {
            if (Math.random() < 0.5) {
              throw new TypeError(
                "undefined is not a number, but it still has feelings."
              );
            }
          });
          break;
        }
        case CommandType.INCREMENT_STATE_COUNTER_INDIRECTLY: {
          ctx
            .serviceSendClient(Service)
            .incrementIndirectly(this.interpreterId);
          break;
        }
        case CommandType.AWAIT_PROMISE: {
          const index = command.index;
          const toAwait = promises.get(index);
          if (!toAwait) {
            // Unexpected. This can be an interpreter bug, and can be a real issue.
            // Not very helpful I know :( but this is truly unexpected to have happen.
            throw new restate.TerminalError(
              `ObjectInterpreter: can not find a promise for the id ${index}.`
            );
          }
          promises.delete(index);
          const { thunk, expected } = toAwait;
          const result = await thunk();
          if (result !== expected) {
            const originalCommandWas = commands[index];
            throw new restate.TerminalError(
              `Awaited promise mismatch. got ${JSON.stringify(
                result
              )}  expected ${JSON.stringify(
                expected
              )} ; command ${JSON.stringify(originalCommandWas)}`
            );
          }
          break;
        }
        case CommandType.RESOLVE_AWAKEABLE: {
          const { id, promise } = ctx.awakeable<string>();
          promises.set(i, { thunk: () => promise, expected: "ok" });
          ctx.serviceSendClient(Service).resolveAwakeable(id);
          break;
        }
        case CommandType.REJECT_AWAKEABLE: {
          const { id, promise } = ctx.awakeable<string>();
          const mapped = promise.map((_v, f) => {
            if (f) {
              return "rejected";
            } else {
              throw new restate.TerminalError("unexpectedly succeeded");
            }
          });
          promises.set(i, {
            thunk: () => mapped,
            expected: "rejected",
          });
          ctx.serviceSendClient(Service).rejectAwakeable(id);
          break;
        }
        case CommandType.INCREMENT_STATE_COUNTER_VIA_AWAKEABLE: {
          // there is a complicated dance here.
          const { id: txPromiseId, promise: txPromise } =
            ctx.awakeable<string>();
          ctx.serviceSendClient(Service).incrementViaAwakeableDance({
            interpreter: this.interpreterId,
            txPromiseId,
          });
          // wait for the helper service to give us a promise to resolve.
          const theirPromiseIdForUsToResolve = await txPromise;
          // let us resolve it
          ctx.resolveAwakeable(theirPromiseIdForUsToResolve, "ok");
          break;
        }
        case CommandType.CALL_NEXT_LAYER_OBJECT: {
          const nextLayer = this.interpreterId.layer + 1;
          const key = `${command.key}`;
          const def = interpreterObjectForLayer(nextLayer);

          const program = command.program;
          const promise = ctx.objectClient(def, key).interpret(program);
          promises.set(i, { thunk: () => promise });
          // safety: we must at least add a catch handler otherwise if the call results with a terminal exception propagated
          // and Node will cause this process to exit.
          // promise.catch(() => {});
          break;
        }
      }
    }
  }
}
