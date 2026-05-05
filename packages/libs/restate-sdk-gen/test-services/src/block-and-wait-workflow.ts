// BlockAndWaitWorkflow — workflow that exercises durable promises and
// state inside a workflow context.
// Mirrors sdk-ruby/test-services/services/block_and_wait_workflow.rb.

import * as restate from "@restatedev/restate-sdk";
import {
  gen,
  execute,
  state,
  sharedState,
  workflowPromise,
} from "@restatedev/restate-sdk-gen";

type WfState = { "my-state": string };

export const blockAndWaitWorkflow = restate.workflow({
  name: "BlockAndWaitWorkflow",
  handlers: {
    run: async (ctx: restate.WorkflowContext, input: string): Promise<string> =>
      execute(
        ctx,
        gen(function* () {
          state<WfState>().set("my-state", input);

          const output = workflowPromise<string>("durable-promise");
          const value = yield* output.get();

          const peeked = yield* output.peek();
          if (peeked === undefined) {
            throw new restate.TerminalError(
              "Durable promise should be completed"
            );
          }
          return value;
        })
      ),

    unblock: async (
      ctx: restate.WorkflowSharedContext,
      output: string
    ): Promise<void> =>
      execute(
        ctx,
        gen(function* () {
          yield* workflowPromise<string>("durable-promise").resolve(output);
        })
      ),

    getState: async (
      ctx: restate.WorkflowSharedContext
    ): Promise<string | null> =>
      execute(
        ctx,
        gen(function* () {
          return (yield* sharedState<WfState>().get("my-state")) ?? null;
        })
      ),
  },
});
