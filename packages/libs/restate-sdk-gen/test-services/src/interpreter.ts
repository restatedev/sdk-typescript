// Interpreter — three-layer object interpreter that runs a small program
// of journaled commands. Used by the test suite to verify
// non-deterministic-replay handling and cross-service control flow.
// Mirrors sdk-ruby/test-services/services/interpreter.rb.

import * as restate from "@restatedev/restate-sdk";
import {
  type Future,
  gen,
  execute,
  state,
  sharedState,
  awakeable,
  resolveAwakeable,
  rejectAwakeable,
  sleep,
  run,
  genericCall,
  genericSend,
} from "@restatedev/restate-sdk-gen";

const SET_STATE = 1;
const GET_STATE = 2;
const CLEAR_STATE = 3;
const INCREMENT_STATE_COUNTER = 4;
const INCREMENT_STATE_COUNTER_INDIRECTLY = 5;
const SLEEP = 6;
const CALL_SERVICE = 7;
const CALL_SLOW_SERVICE = 8;
const INCREMENT_VIA_DELAYED_CALL = 9;
const SIDE_EFFECT = 10;
const THROWING_SIDE_EFFECT = 11;
const SLOW_SIDE_EFFECT = 12;
const RECOVER_TERMINAL_CALL = 13;
const RECOVER_TERMINAL_MAYBE_UN_AWAITED = 14;
const AWAIT_PROMISE = 15;
const RESOLVE_AWAKEABLE = 16;
const REJECT_AWAKEABLE = 17;
const INCREMENT_STATE_COUNTER_VIA_AWAKEABLE = 18;
const CALL_NEXT_LAYER_OBJECT = 19;

// Untyped command shape — the test suite sends a JSON program with
// indices and durations as plain numbers.
type Cmd = {
  kind: number;
  key?: number;
  duration?: number;
  sleep?: number;
  index?: number;
  program?: { commands: Cmd[] };
};
type Program = { commands: Cmd[] };

// =============================================================================
// ServiceInterpreterHelper — service the interpreter calls into for echo,
// awakeable resolution, etc.
// =============================================================================

export const serviceInterpreterHelper = restate.service({
  name: "ServiceInterpreterHelper",
  handlers: {
    ping: async (_ctx: restate.Context): Promise<void> => {},

    echo: restate.handlers.handler(
      { input: restate.serde.json, output: restate.serde.json },
      async (_ctx: restate.Context, param: string): Promise<string> => param
    ),

    echoLater: async (
      ctx: restate.Context,
      req: { sleep: number; parameter: string }
    ): Promise<string> =>
      execute(
        ctx,
        gen(function* () {
          yield* sleep(req.sleep);
          return req.parameter;
        })
      ),

    terminalFailure: async (_ctx: restate.Context): Promise<void> => {
      throw new restate.TerminalError("bye");
    },

    incrementIndirectly: async (
      ctx: restate.Context,
      param: { layer: 0 | 1 | 2; key: string }
    ): Promise<void> =>
      execute(
        ctx,
        gen(function* () {
          const program: Program = {
            commands: [{ kind: INCREMENT_STATE_COUNTER }],
          };
          genericSend({
            service: `ObjectInterpreterL${param.layer}`,
            method: "interpret",
            parameter: program,
            key: param.key,
            inputSerde: restate.serde.json,
          });
        })
      ),

    resolveAwakeable: async (
      ctx: restate.Context,
      aid: string
    ): Promise<void> =>
      execute(
        ctx,
        gen(function* () {
          resolveAwakeable(aid, "ok");
        })
      ),

    rejectAwakeable: async (ctx: restate.Context, aid: string): Promise<void> =>
      execute(
        ctx,
        gen(function* () {
          rejectAwakeable(aid, "error");
        })
      ),

    incrementViaAwakeableDance: async (
      ctx: restate.Context,
      input: {
        txPromiseId: string;
        interpreter: { layer: 0 | 1 | 2; key: string };
      }
    ): Promise<void> =>
      execute(
        ctx,
        gen(function* () {
          const { id, promise } = awakeable<string>();
          resolveAwakeable(input.txPromiseId, id);
          yield* promise;

          const program: Program = {
            commands: [{ kind: INCREMENT_STATE_COUNTER }],
          };
          genericSend({
            service: `ObjectInterpreterL${input.interpreter.layer}`,
            method: "interpret",
            parameter: program,
            key: input.interpreter.key,
            inputSerde: restate.serde.json,
          });
        })
      ),
  },
});

// =============================================================================
// Per-layer object interpreter. The three definitions are identical except
// for the service name and the layer constant baked in. We share the
// handler factory.
// =============================================================================

type Coro = {
  expected: unknown;
  future: Future<unknown>;
  deserialize: boolean;
};

function makeInterpretHandler(layer: 0 | 1 | 2) {
  return async (ctx: restate.ObjectContext, program: Program): Promise<void> =>
    execute(
      ctx,
      gen(function* () {
        const coros = new Map<number, Coro>();

        function* awaitPromise(
          index: number
        ): Generator<unknown, void, unknown> {
          const c = coros.get(index);
          if (!c) return;
          coros.delete(index);
          let result: unknown;
          try {
            const raw = yield* c.future;
            if (c.deserialize && typeof raw === "string" && raw.length > 0) {
              result = JSON.parse(raw);
            } else if (
              c.deserialize &&
              raw instanceof Uint8Array &&
              raw.length > 0
            ) {
              result = JSON.parse(new TextDecoder().decode(raw));
            } else {
              result = raw;
            }
          } catch (e) {
            if (e instanceof restate.TerminalError) {
              result = "rejected";
            } else {
              throw e;
            }
          }
          if (JSON.stringify(result) !== JSON.stringify(c.expected)) {
            throw new restate.TerminalError(
              `Expected ${JSON.stringify(c.expected)} but got ${JSON.stringify(result)}`
            );
          }
        }

        function* interpretOne(
          cmd: Cmd,
          i: number
        ): Generator<unknown, void, unknown> {
          switch (cmd.kind) {
            case SET_STATE:
              state().set(`key-${cmd.key}`, `value-${cmd.key}`);
              return;
            case GET_STATE:
              yield* state().get<string>(`key-${cmd.key}`);
              return;
            case CLEAR_STATE:
              state().clear(`key-${cmd.key}`);
              return;
            case INCREMENT_STATE_COUNTER: {
              const c = (yield* state().get<number>("counter")) ?? 0;
              state().set("counter", c + 1);
              return;
            }
            case SLEEP:
              yield* sleep(cmd.duration ?? 0);
              return;
            case CALL_SERVICE: {
              const expected = `hello-${i}`;
              const future = genericCall<string, string>({
                service: "ServiceInterpreterHelper",
                method: "echo",
                parameter: expected,
                inputSerde: restate.serde.json,
                outputSerde: restate.serde.json,
              });
              coros.set(i, { expected, future, deserialize: false });
              return;
            }
            case CALL_SLOW_SERVICE: {
              const expected = `hello-${i}`;
              const arg = { parameter: expected, sleep: cmd.sleep ?? 0 };
              const future = genericCall<typeof arg, string>({
                service: "ServiceInterpreterHelper",
                method: "echoLater",
                parameter: arg,
                inputSerde: restate.serde.json,
                outputSerde: restate.serde.json,
              });
              coros.set(i, { expected, future, deserialize: false });
              return;
            }
            case INCREMENT_VIA_DELAYED_CALL: {
              const arg = { layer, key: ctx.key };
              genericSend({
                service: "ServiceInterpreterHelper",
                method: "incrementIndirectly",
                parameter: arg,
                inputSerde: restate.serde.json,
                delay: cmd.duration,
              });
              return;
            }
            case SIDE_EFFECT: {
              const expected = `hello-${i}`;
              const result = yield* run(async () => expected, {
                name: "sideEffect",
              });
              if (result !== expected) {
                throw new restate.TerminalError(
                  `Expected ${expected} but got ${result}`
                );
              }
              return;
            }
            case SLOW_SIDE_EFFECT:
              return;
            case RECOVER_TERMINAL_CALL: {
              try {
                yield* genericCall<null, void>({
                  service: "ServiceInterpreterHelper",
                  method: "terminalFailure",
                  parameter: null,
                  inputSerde: restate.serde.json,
                });
                throw new restate.TerminalError("Expected terminal error");
              } catch (e) {
                if (!(e instanceof restate.TerminalError)) throw e;
                return;
              }
            }
            case RECOVER_TERMINAL_MAYBE_UN_AWAITED:
              return;
            case THROWING_SIDE_EFFECT:
              yield* run(
                async () => {
                  if (Math.random() < 0.5) throw new Error("Random error");
                },
                { name: "throwingSideEffect" }
              );
              return;
            case INCREMENT_STATE_COUNTER_INDIRECTLY: {
              const arg = { layer, key: ctx.key };
              genericSend({
                service: "ServiceInterpreterHelper",
                method: "incrementIndirectly",
                parameter: arg,
                inputSerde: restate.serde.json,
              });
              return;
            }
            case RESOLVE_AWAKEABLE: {
              const { id, promise } = awakeable<string>();
              coros.set(i, {
                expected: "ok",
                future: promise,
                deserialize: false,
              });
              genericSend({
                service: "ServiceInterpreterHelper",
                method: "resolveAwakeable",
                parameter: id,
                inputSerde: restate.serde.json,
              });
              return;
            }
            case REJECT_AWAKEABLE: {
              const { id, promise } = awakeable<string>();
              coros.set(i, {
                expected: "rejected",
                future: promise,
                deserialize: false,
              });
              genericSend({
                service: "ServiceInterpreterHelper",
                method: "rejectAwakeable",
                parameter: id,
                inputSerde: restate.serde.json,
              });
              return;
            }
            case INCREMENT_STATE_COUNTER_VIA_AWAKEABLE: {
              const { id: txAid, promise: txPromise } = awakeable<string>();
              const arg = {
                interpreter: { layer, key: ctx.key },
                txPromiseId: txAid,
              };
              genericSend({
                service: "ServiceInterpreterHelper",
                method: "incrementViaAwakeableDance",
                parameter: arg,
                inputSerde: restate.serde.json,
              });
              const theirAid = yield* txPromise;
              resolveAwakeable(theirAid, "ok");
              return;
            }
            case CALL_NEXT_LAYER_OBJECT: {
              const nextLayer = `ObjectInterpreterL${layer + 1}`;
              const key = String(cmd.key ?? "");
              const future = genericCall<Program, void>({
                service: nextLayer,
                method: "interpret",
                parameter: cmd.program ?? { commands: [] },
                key,
                inputSerde: restate.serde.json,
              });
              coros.set(i, { expected: "", future, deserialize: false });
              return;
            }
            default:
              throw new restate.TerminalError(
                `Unknown command type: ${cmd.kind}`
              );
          }
        }

        for (let i = 0; i < program.commands.length; i++) {
          const cmd = program.commands[i]!;
          if (cmd.kind === AWAIT_PROMISE && cmd.index !== undefined) {
            yield* awaitPromise(cmd.index);
          } else {
            yield* interpretOne(cmd, i);
          }
          yield* awaitPromise(i);
        }
      })
    );
}

const sharedCounter = restate.handlers.object.shared(
  async (ctx: restate.ObjectSharedContext): Promise<number> =>
    execute(
      ctx,
      gen(function* () {
        return (yield* sharedState().get<number>("counter")) ?? 0;
      })
    )
);

export const objectInterpreterL0 = restate.object({
  name: "ObjectInterpreterL0",
  handlers: {
    interpret: makeInterpretHandler(0),
    counter: sharedCounter,
  },
});

export const objectInterpreterL1 = restate.object({
  name: "ObjectInterpreterL1",
  handlers: {
    interpret: makeInterpretHandler(1),
    counter: sharedCounter,
  },
});

export const objectInterpreterL2 = restate.object({
  name: "ObjectInterpreterL2",
  handlers: {
    interpret: makeInterpretHandler(2),
    counter: sharedCounter,
  },
});
