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
import { TerminalError } from "@restatedev/restate-sdk";

let eventualSuccessCalls = 0;
let eventualSuccessSideEffectCalls = 0;
let eventualFailureSideEffectCalls = 0;

const service = restate.object({
  name: "Failing",
  handlers: {
    terminallyFailingCall: (
      _ctx: restate.Context,
      message: string
    ): Promise<void> => {
      throw new restate.TerminalError(message);
    },

    callTerminallyFailingCall: async (
      ctx: restate.ObjectContext,
      message: string
    ): Promise<void> => {
      const uuid = ctx.rand.uuidv4();

      await ctx.objectClient(Failing, uuid).terminallyFailingCall(message);

      throw new Error("This should be unreachable");
    },

    failingCallWithEventualSuccess: (): Promise<number> => {
      eventualSuccessCalls += 1;
      const currentAttempt = eventualSuccessCalls;

      if (currentAttempt >= 4) {
        eventualSuccessCalls = 0;
        return Promise.resolve(currentAttempt);
      } else {
        throw new Error("Failed at attempt: " + currentAttempt);
      }
    },

    terminallyFailingSideEffect: async (
      ctx: restate.ObjectContext,
      errorMessage: string
    ) => {
      await ctx.run(() => {
        throw new restate.TerminalError(errorMessage);
      });

      throw new Error("Should not be reached.");
    },

    sideEffectSucceedsAfterGivenAttempts: async (
      context: restate.ObjectContext,
      minimumAttempts: number
    ) => {
      return await context.run(() => {
        eventualSuccessSideEffectCalls += 1;
        const currentAttempt = eventualSuccessSideEffectCalls;

        if (currentAttempt >= minimumAttempts) {
          eventualSuccessSideEffectCalls = 0;
          return currentAttempt;
        } else {
          throw new Error("Failed at attempt: " + currentAttempt);
        }
      });
    },

    sideEffectFailsAfterGivenAttempts: async (
      context: restate.ObjectContext,
      retryPolicyMaxRetryCount: number
    ) => {
      try {
        await context.run(
          "failing-side-effect",
          () => {
            eventualFailureSideEffectCalls += 1;
            throw new Error(
              "Failed at attempt: " + eventualFailureSideEffectCalls
            );
          },
          { maxAttempts: retryPolicyMaxRetryCount }
        );
      } catch (e) {
        if (e instanceof TerminalError) {
          context.console.log(
            `run failed as expected with ${JSON.stringify(e)}`
          );
          return eventualFailureSideEffectCalls;
        }
        // This is not a TerminalError!
        throw e;
      }
      throw new TerminalError("Side effect was supposed to fail!");
    },
  },
});

type Failing = typeof service;
const Failing: Failing = { name: "Failing" };

REGISTRY.addService(service);
