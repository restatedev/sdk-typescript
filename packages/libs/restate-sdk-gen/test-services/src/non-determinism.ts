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

// NonDeterministic — virtual object whose handlers branch
// non-deterministically across invocations. Used by the test suite to
// verify the SDK rejects non-deterministic replay.
// Mirrors sdk-ruby/test-services/services/non_determinism.rb.

import * as restate from "@restatedev/restate-sdk";
import {
  gen,
  execute,
  state,
  sleep,
  objectClient,
  objectSendClient,
} from "@restatedev/restate-sdk-gen";
import type { counterObject } from "./counter.js";

const invokeCounts = new Map<string, number>();

function doLeftAction(key: string): boolean {
  const next = (invokeCounts.get(key) ?? 0) + 1;
  invokeCounts.set(key, next);
  return next % 2 === 1;
}

const CounterApi: restate.VirtualObjectDefinitionFrom<typeof counterObject> = {
  name: "Counter",
};

export const nonDeterministic = restate.object({
  name: "NonDeterministic",
  handlers: {
    setDifferentKey: async (ctx: restate.ObjectContext): Promise<void> =>
      execute(
        ctx,
        gen(function* () {
          if (doLeftAction(ctx.key)) {
            state().set("a", "my-state");
          } else {
            state().set("b", "my-state");
          }
          yield* sleep(100);
          objectSendClient(CounterApi, ctx.key).add(1);
        })
      ),

    backgroundInvokeWithDifferentTargets: async (
      ctx: restate.ObjectContext
    ): Promise<void> =>
      execute(
        ctx,
        gen(function* () {
          if (doLeftAction(ctx.key)) {
            objectSendClient(CounterApi, "abc").get();
          } else {
            objectSendClient(CounterApi, "abc").reset();
          }
          yield* sleep(100);
          objectSendClient(CounterApi, ctx.key).add(1);
        })
      ),

    callDifferentMethod: async (ctx: restate.ObjectContext): Promise<void> =>
      execute(
        ctx,
        gen(function* () {
          if (doLeftAction(ctx.key)) {
            yield* objectClient(CounterApi, "abc").get();
          } else {
            yield* objectClient(CounterApi, "abc").reset();
          }
          yield* sleep(100);
          objectSendClient(CounterApi, ctx.key).add(1);
        })
      ),

    eitherSleepOrCall: async (ctx: restate.ObjectContext): Promise<void> =>
      execute(
        ctx,
        gen(function* () {
          if (doLeftAction(ctx.key)) {
            yield* sleep(100);
          } else {
            yield* objectClient(CounterApi, "abc").get();
          }
          yield* sleep(100);
          objectSendClient(CounterApi, ctx.key).add(1);
        })
      ),
  },
});
