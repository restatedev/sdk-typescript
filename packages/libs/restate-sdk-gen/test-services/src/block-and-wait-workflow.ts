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
import {
  workflow,
  state,
  sharedState,
  workflowPromise,
} from "@restatedev/restate-sdk-gen";

type WfState = { "my-state": string };

export const blockAndWaitWorkflow = workflow({
  name: "BlockAndWaitWorkflow",
  handlers: {
    *run(input: string) {
      state<WfState>().set("my-state", input);
      const output = workflowPromise<string>("durable-promise");
      const value = yield* output.get();
      const peeked = yield* output.peek();
      if (peeked === undefined) {
        throw new restate.TerminalError("Durable promise should be completed");
      }
      return value;
    },

    *unblock(output: string) {
      yield* workflowPromise<string>("durable-promise").resolve(output);
    },

    *getState() {
      return (yield* sharedState<WfState>().get("my-state")) ?? null;
    },
  },
});
