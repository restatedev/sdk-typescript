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
import { object, call, run } from "@restatedev/restate-sdk-gen";

let failures = 0;
let eventualSuccessSideEffects = 0;
let eventualFailureSideEffects = 0;

type FailureToPropagate = {
  errorMessage: string;
  metadata?: Record<string, string>;
};

export const failing = object({
  name: "Failing",
  handlers: {
    *terminallyFailingCall(f: FailureToPropagate) {
      throw new restate.TerminalError(f.errorMessage, { metadata: f.metadata });
    },

    *callTerminallyFailingCall(f: FailureToPropagate) {
      // Self-referential — use call() with string name to avoid circular type inference
      yield* call<FailureToPropagate, void>({
        service: "Failing",
        method: "terminallyFailingCall",
        key: "random-583e1bf2",
        parameter: f,
        inputSerde: restate.serde.json,
      });
      throw new Error("Should not reach here");
    },

    *failingCallWithEventualSuccess() {
      failures += 1;
      if (failures >= 4) {
        failures = 0;
        return 4;
      }
      throw new Error(`Failed at attempt: ${failures}`);
    },

    *terminallyFailingSideEffect(f: FailureToPropagate) {
      yield* run(
        async () => {
          throw new restate.TerminalError(f.errorMessage, {
            metadata: f.metadata,
          });
        },
        { name: "sideEffect" }
      );
      throw new Error("Should not reach here");
    },

    *sideEffectSucceedsAfterGivenAttempts(minimumAttempts: number) {
      return yield* run<number>(
        async () => {
          eventualSuccessSideEffects += 1;
          if (eventualSuccessSideEffects < minimumAttempts) {
            throw new Error(`Failed at attempt: ${eventualSuccessSideEffects}`);
          }
          return eventualSuccessSideEffects;
        },
        {
          name: "sideEffect",
          retry: {
            maxAttempts: minimumAttempts + 1,
            initialInterval: 1,
            intervalFactor: 1.0,
          },
        }
      );
    },

    *sideEffectFailsAfterGivenAttempts(retryPolicyMaxRetryCount: number) {
      try {
        yield* run<number>(
          async () => {
            eventualFailureSideEffects += 1;
            throw new Error(`Failed at attempt: ${eventualFailureSideEffects}`);
          },
          {
            name: "sideEffect",
            retry: {
              maxAttempts: retryPolicyMaxRetryCount,
              initialInterval: 1,
              intervalFactor: 1.0,
            },
          }
        );
        throw new Error("Side effect did not fail.");
      } catch (e) {
        if (e instanceof restate.TerminalError) {
          return eventualFailureSideEffects;
        }
        throw e;
      }
    },
  },
});
