// Failing — virtual object that exercises terminal-error and retry
// semantics in handler bodies and `ctx.run` closures.
// Mirrors sdk-ruby/test-services/services/failing.rb.

import * as restate from "@restatedev/restate-sdk";
import { gen, execute, run, objectClient } from "@restatedev/restate-sdk-gen";

// Process-wide attempt counters. The Ruby version uses globals; we do
// the same — the SDK test suite spawns a fresh service container per
// run, so cross-test bleed isn't a concern.
let failures = 0;
let eventualSuccessSideEffects = 0;
let eventualFailureSideEffects = 0;

// Shape sdk-test-suite uses to drive failure-propagation tests.
type FailureToPropagate = {
  errorMessage: string;
  metadata?: Record<string, string>;
};

const FailingApi: restate.VirtualObjectDefinitionFrom<typeof failing> = {
  name: "Failing",
};

export const failing = restate.object({
  name: "Failing",
  handlers: {
    terminallyFailingCall: async (
      ctx: restate.ObjectContext,
      f: FailureToPropagate
    ): Promise<void> => {
      void ctx;
      throw new restate.TerminalError(f.errorMessage, { metadata: f.metadata });
    },

    callTerminallyFailingCall: async (
      ctx: restate.ObjectContext,
      f: FailureToPropagate
    ): Promise<string> =>
      execute(
        ctx,
        gen(function* () {
          yield* objectClient(
            FailingApi,
            "random-583e1bf2"
          ).terminallyFailingCall(f);
          throw new Error("Should not reach here");
        })
      ),

    failingCallWithEventualSuccess: async (
      ctx: restate.ObjectContext
    ): Promise<number> => {
      void ctx;
      failures += 1;
      if (failures >= 4) {
        failures = 0;
        return 4;
      }
      throw new Error(`Failed at attempt: ${failures}`);
    },

    terminallyFailingSideEffect: async (
      ctx: restate.ObjectContext,
      f: FailureToPropagate
    ): Promise<void> =>
      execute(
        ctx,
        gen(function* () {
          yield* run(
            async () => {
              throw new restate.TerminalError(f.errorMessage, {
                metadata: f.metadata,
              });
            },
            { name: "sideEffect" }
          );
          throw new Error("Should not reach here");
        })
      ),

    sideEffectSucceedsAfterGivenAttempts: async (
      ctx: restate.ObjectContext,
      minimumAttempts: number
    ): Promise<number> =>
      execute(
        ctx,
        gen(function* () {
          return yield* run<number>(
            async () => {
              eventualSuccessSideEffects += 1;
              if (eventualSuccessSideEffects < minimumAttempts) {
                throw new Error(
                  `Failed at attempt: ${eventualSuccessSideEffects}`
                );
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
        })
      ),

    sideEffectFailsAfterGivenAttempts: async (
      ctx: restate.ObjectContext,
      retryPolicyMaxRetryCount: number
    ): Promise<number> =>
      execute(
        ctx,
        gen(function* () {
          try {
            yield* run<number>(
              async () => {
                eventualFailureSideEffects += 1;
                throw new Error(
                  `Failed at attempt: ${eventualFailureSideEffects}`
                );
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
        })
      ),
  },
});
