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

let eventualSuccessCalls = 0;
let eventualSuccessSideEffectCalls = 0;

const service = restate.object({
  name: "Failing",
  handlers: {
    terminallyFailingCall: async (
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

    failingCallWithEventualSuccess: async (): Promise<number> => {
      eventualSuccessCalls += 1;
      const currentAttempt = eventualSuccessCalls;

      if (currentAttempt >= 4) {
        eventualSuccessCalls = 0;
        return currentAttempt;
      } else {
        throw new Error("Failed at attempt: " + currentAttempt);
      }
    },

    failingSideEffectWithEventualSuccess: async (
      context: restate.ObjectContext
    ) => {
      const successAttempt = await context.run(() => {
        eventualSuccessSideEffectCalls += 1;
        const currentAttempt = eventualSuccessSideEffectCalls;

        if (currentAttempt >= 4) {
          eventualSuccessSideEffectCalls = 0;
          return currentAttempt;
        } else {
          throw new Error("Failed at attempt: " + currentAttempt);
        }
      });

      return successAttempt;
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
  },
});

type Failing = typeof service;
const Failing: Failing = { name: "Failing" };

REGISTRY.addService(service);
