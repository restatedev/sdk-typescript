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

const wf = restate.workflow({
  name: "WorkflowBlockAndWait",
  handlers: {
    run: async (ctx: restate.WorkflowContext, input: string) => {
      ctx.set("input", input);

      const output = await ctx.promise("p");

      if (ctx.promise("p").peek() == undefined) {
        throw new restate.TerminalError("Durable promise should be completed");
      }

      return output;
    },

    unblock: async (ctx: restate.WorkflowSharedContext, input: string) => {
      await ctx.promise<string>("p").resolve(input);
    },

    getState: async (ctx: restate.WorkflowSharedContext) => {
      const input = await ctx.get("input");
      if (!input) {
        return undefined;
      } else {
        return input;
      }
    },
  },
});

REGISTRY.addWorkflow(wf);
