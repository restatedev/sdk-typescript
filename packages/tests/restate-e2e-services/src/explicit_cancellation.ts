// Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
//
// This file is part of the Restate e2e tests,
// which are released under the MIT license.
//
// You can find a copy of the license in file LICENSE in the root
// directory of this repository or package, or at
// https://github.com/restatedev/e2e/blob/main/LICENSE

import * as restate from "@restatedev/restate-sdk";
import { RestatePromise } from "@restatedev/restate-sdk";
import { REGISTRY } from "./services.js";

// Helper service that blocks forever, used as a call target for cancelPreviousCalls tests
const blockForever = restate.service({
  name: "BlockForever",
  handlers: {
    block: async (ctx: restate.Context): Promise<string> => {
      await ctx.sleep({ days: 1 });
      return "should-never-return";
    },
  },
});

const BlockForever: typeof blockForever = { name: "BlockForever" };

const explicitCancellationService = restate.service({
  name: "ExplicitCancellation",
  handlers: {
    /**
     * Race a long sleep against cancellation.
     * When cancelled, throws TerminalError("Cancelled").
     */
    raceAgainstCancellation: async (ctx: restate.Context): Promise<string> => {
      const ctxInternal = ctx as restate.internal.ContextInternal;
      return RestatePromise.race([
        ctx.sleep({ days: 1 }).map(() => "not-cancelled"),
        ctxInternal.cancellation().map(() => {
          throw new restate.TerminalError("Cancelled");
        }),
      ]);
    },

    /**
     * Race a long sleep against cancellation, catch it, do cleanup,
     * then return "cleanup-done".
     */
    doubleCancellation: async (ctx: restate.Context): Promise<string> => {
      const ctxInternal = ctx as restate.internal.ContextInternal;
      try {
        await RestatePromise.race([
          ctx.sleep({ days: 1 }).map(() => "not-cancelled"),
          ctxInternal.cancellation().map(() => {
            throw new restate.TerminalError("Cancelled");
          }),
        ]);
        return "not-cancelled";
      } catch (e) {
        if (
          !(e instanceof restate.TerminalError) ||
          e.message !== "Cancelled"
        ) {
          throw e;
        }

        // Perform cleanup
        await ctx.run("cleanup", () => "cleaned-up");

        // After cancellation resolved, cancellation() returns a fresh promise.
        // Race cleanup confirmation against the next cancellation signal.
        return await RestatePromise.race([
          ctx.run("confirm-cleanup", () => "cleanup-done"),
          ctxInternal.cancellation().map(() => {
            throw new restate.TerminalError("Cancelled during cleanup");
          }),
        ]);
      }
    },

    /**
     * Use cancellation to abort a ctx.run via AbortController.
     * When cancelled, the run's fetch-like operation gets aborted,
     * and we throw TerminalError("Aborted").
     */
    abortControllerInRun: async (
      ctx: restate.Context,
      count: number
    ): Promise<string> => {
      const ctxInternal = ctx as restate.internal.ContextInternal;
      const controller = new AbortController();
      const cancellation = ctxInternal.cancellation().map(() => {
        controller.abort();
        return "controller-abort";
      });

      // Launch N ctx.run operations that all respect the same AbortController
      const runPromises: RestatePromise<string>[] = [];
      for (let i = 0; i < count; i++) {
        runPromises.push(
          ctx.run(`long-running-${i}`, () => {
            return new Promise<string>((resolve) => {
              const timeout = globalThis.setTimeout(
                () => resolve("not-cancelled"),
                86400000
              );
              controller.signal.addEventListener("abort", () => {
                clearTimeout(timeout);
                resolve("run-cancelled");
              });
            });
          })
        );
      }

      const raceResult = await RestatePromise.race([
        ...runPromises,
        cancellation,
      ]);

      // After cancellation, all runs should resolve with "run-cancelled"
      const runResults = await RestatePromise.all(runPromises);

      return raceResult + "-" + runResults.join(",");
    },
    /**
     * Make N calls to BlockForever, then cancelPreviousCalls.
     * Returns the list of cancelled invocation IDs.
     */
    cancelCalls: async (
      ctx: restate.Context,
      count: number
    ): Promise<string[]> => {
      const ctxInternal = ctx as restate.internal.ContextInternal;

      // Fire N calls (don't await them — they'd block forever)
      for (let i = 0; i < count; i++) {
        ctx.serviceClient(BlockForever).block();
      }

      // Cancel all tracked calls
      return ctxInternal.cancelPreviousCalls();
    },

    /**
     * Make N calls, cancel them, make M more calls, cancel again.
     * Returns [firstBatch, secondBatch] of cancelled invocation IDs.
     */
    cancelCallsTwoBatches: async (
      ctx: restate.Context,
      request: { first: number; second: number }
    ): Promise<[string[], string[]]> => {
      const ctxInternal = ctx as restate.internal.ContextInternal;

      for (let i = 0; i < request.first; i++) {
        ctx.serviceClient(BlockForever).block();
      }
      const firstBatch = await ctxInternal.cancelPreviousCalls();

      for (let i = 0; i < request.second; i++) {
        ctx.serviceClient(BlockForever).block();
      }
      const secondBatch = await ctxInternal.cancelPreviousCalls();

      return [firstBatch, secondBatch];
    },
  },
  options: { explicitCancellation: true },
});

REGISTRY.addService(blockForever);
REGISTRY.addService(explicitCancellationService);

export type ExplicitCancellation = typeof explicitCancellationService;
