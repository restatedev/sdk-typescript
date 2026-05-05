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

// Cancel-test — pair of virtual objects used to drive cancellation
// scenarios: one runner that starts the test and verifies, one
// blocker that waits on an awakeable / sleep / call until cancelled.
// Mirrors sdk-ruby/test-services/services/cancel_test.rb.

import * as restate from "@restatedev/restate-sdk";
import {
  gen,
  execute,
  state,
  sharedState,
  objectClient,
  awakeable,
  sleep,
} from "@restatedev/restate-sdk-gen";
import type { awakeableHolder } from "./awakeable-holder.js";

const AwakeableHolderApi: restate.VirtualObjectDefinitionFrom<
  typeof awakeableHolder
> = { name: "AwakeableHolder" };

type RunnerState = { state: boolean };

export const cancelTestRunner = restate.object({
  name: "CancelTestRunner",
  handlers: {
    startTest: async (ctx: restate.ObjectContext, op: string): Promise<void> =>
      execute(
        ctx,
        gen(function* () {
          try {
            yield* objectClient(CancelTestBlockingApi, ctx.key).block(op);
          } catch (e) {
            if (e instanceof restate.TerminalError && e.code === 409) {
              state<RunnerState>().set("state", true);
              return;
            }
            throw e;
          }
        })
      ),

    verifyTest: async (ctx: restate.ObjectSharedContext): Promise<boolean> =>
      execute(
        ctx,
        gen(function* () {
          const v = yield* sharedState<RunnerState>().get("state");
          return v === true;
        })
      ),
  },
});

const CancelTestBlockingApi: restate.VirtualObjectDefinitionFrom<
  typeof cancelTestBlockingService
> = { name: "CancelTestBlockingService" };

export const cancelTestBlockingService = restate.object({
  name: "CancelTestBlockingService",
  handlers: {
    block: async (ctx: restate.ObjectContext, op: string): Promise<void> =>
      execute(
        ctx,
        gen(function* () {
          const { id, promise } = awakeable<string>();
          yield* objectClient(AwakeableHolderApi, ctx.key).hold(id);
          yield* promise;

          switch (op) {
            case "CALL":
              yield* objectClient(CancelTestBlockingApi, ctx.key).block(op);
              break;
            case "SLEEP":
              yield* sleep(1024 * 24 * 60 * 60 * 1000);
              break;
            case "AWAKEABLE": {
              const { promise: p2 } = awakeable<string>();
              yield* p2;
              break;
            }
          }
        })
      ),

    isUnlocked: async (_ctx: restate.ObjectContext): Promise<void> => {
      // No-op probe handler; the test suite calls this to confirm the
      // VO unlocked after cancellation.
    },
  },
});
