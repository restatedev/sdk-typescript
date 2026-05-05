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

// Tier 9: workflows + durable promises.
//
// Maps to guide.md §"Workflows". A workflow is a virtual object with a
// distinguished `run` handler that executes once per workflow id. Other
// handlers are shared (read-only by default; can mutate state).
//
// Headline primitive for workflows: **`workflowPromise(name)`**. A
// durable promise bound to the workflow's lifetime — `get()` parks until
// it's resolved, `peek()` returns the current value if any, `resolve()`
// / `reject()` settle it. The classic pattern: `run` registers a promise
// and yields on `get()`; an external handler (or another service) calls
// `resolve()` to unpark it.

import * as restate from "@restatedev/restate-sdk";
import {
  gen,
  execute,
  state,
  sharedState,
  workflowPromise,
} from "@restatedev/restate-sdk-gen";

type WfState = { input: string };

export const blockAndWaitWorkflow = restate.workflow({
  name: "blockAndWait",
  handlers: {
    // The `run` handler: stores its input in state, parks on a durable
    // promise, returns the resolved value.
    run: async (ctx: restate.WorkflowContext, input: string): Promise<string> =>
      execute(
        ctx,
        gen(function* () {
          state<WfState>().set("input", input);

          // Park until someone calls `unblock` on this workflow id.
          const output = workflowPromise<string>("done");
          const value = yield* output.get();

          // After settle, peek() returns the same value synchronously.
          // Useful for sanity checks; not load-bearing.
          const peeked = yield* output.peek();
          if (peeked === undefined) {
            throw new restate.TerminalError(
              "durable promise should be resolved by now"
            );
          }
          return value;
        })
      ),

    // Shared handler — completes the durable promise. Anyone who knows
    // the workflow id can call this to unpark `run`. Idempotent: a
    // subsequent resolve is a no-op (the SDK records the first).
    unblock: async (
      ctx: restate.WorkflowSharedContext,
      output: string
    ): Promise<void> =>
      execute(
        ctx,
        gen(function* () {
          yield* workflowPromise<string>("done").resolve(output);
        })
      ),

    // Shared handler — read the input that `run` stashed. Demonstrates
    // that workflows have state too, accessible from shared handlers
    // without blocking `run`.
    getInput: async (
      ctx: restate.WorkflowSharedContext
    ): Promise<string | null> =>
      execute(
        ctx,
        gen(function* () {
          return (yield* sharedState<WfState>().get("input")) ?? null;
        })
      ),
  },
});
