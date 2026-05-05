// TestUtilsService — service with a grab-bag of utility handlers used
// across the test suite (echo, raw echo, sleep-concurrently, count side
// effects, cancel-invocation).
// Mirrors sdk-ruby/test-services/services/test_utils.rb.

import * as restate from "@restatedev/restate-sdk";
import { gen, execute, run, sleep, all } from "@restatedev/restate-sdk-gen";

export const testUtilsService = restate.service({
  name: "TestUtilsService",
  handlers: {
    echo: async (_ctx: restate.Context, input: string): Promise<string> =>
      input,

    uppercaseEcho: async (
      _ctx: restate.Context,
      input: string
    ): Promise<string> => input.toUpperCase(),

    echoHeaders: async (
      ctx: restate.Context
    ): Promise<Record<string, string>> => {
      const out: Record<string, string> = {};
      for (const [k, v] of ctx.request().headers) out[k] = v;
      return out;
    },

    rawEcho: restate.handlers.handler(
      {
        accept: "*/*",
        input: restate.serde.binary,
        output: restate.serde.binary,
      },
      async (_ctx: restate.Context, input: Uint8Array): Promise<Uint8Array> =>
        input
    ),

    countExecutedSideEffects: async (
      ctx: restate.Context,
      increments: number
    ): Promise<number> =>
      execute(
        ctx,
        gen(function* () {
          let invokedSideEffects = 0;
          for (let i = 0; i < increments; i++) {
            yield* run(
              async () => {
                invokedSideEffects += 1;
              },
              { name: "count" }
            );
          }
          return invokedSideEffects;
        })
      ),

    cancelInvocation: async (
      ctx: restate.Context,
      invocationId: string
    ): Promise<void> => {
      // ctx.cancel is sync — no scheduler/generator needed.
      ctx.cancel(invocationId as restate.InvocationId);
    },

    sleepConcurrently: async (
      ctx: restate.Context,
      millisList: number[]
    ): Promise<void> =>
      execute(
        ctx,
        gen(function* () {
          const futures = millisList.map((ms) => sleep(ms));
          yield* all(futures);
        })
      ),
  },
});
