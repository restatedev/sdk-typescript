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

// Counter — virtual object exercising basic state I/O.
// Written in the free-standing style: handler bodies call `state()`
// directly, no `ops` parameter.
// Mirrors sdk-ruby/test-services/services/counter.rb.

import * as restate from "@restatedev/restate-sdk";
import { gen, execute, state } from "@restatedev/restate-sdk-gen";

const counterState = state({ counter: { default: 0 } });

export const counterObject = restate.object({
  name: "Counter",
  handlers: {
    reset: async (ctx: restate.ObjectContext): Promise<void> =>
      execute(
        ctx,
        gen(function* () {
          counterState.counter.clear();
        })
      ),

    get: async (ctx: restate.ObjectSharedContext): Promise<number> =>
      execute(
        ctx,
        gen(function* () {
          return yield* counterState.counter.get();
        })
      ),

    add: async (
      ctx: restate.ObjectContext,
      addend: number
    ): Promise<{ oldValue: number; newValue: number }> =>
      execute(
        ctx,
        gen(function* () {
          const oldValue: number = yield* counterState.counter.get();
          const newValue = oldValue + addend;
          counterState.counter.set(newValue);
          return { oldValue, newValue };
        })
      ),

    addThenFail: async (
      ctx: restate.ObjectContext,
      addend: number
    ): Promise<void> =>
      execute(
        ctx,
        gen(function* () {
          const oldValue: number = yield* counterState.counter.get();
          counterState.counter.set(oldValue + addend);
          throw new restate.TerminalError(ctx.key);
        })
      ),
  },
});
