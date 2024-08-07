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

const c = restate.object({
  name: "Receiver",
  handlers: {
    async ping(): Promise<string> {
      return "pong";
    },

    async setValue(ctx: restate.ObjectContext, value: string) {
      ctx.set("my-state", value);
    },

    async getValue(ctx: restate.ObjectContext): Promise<string> {
      return (await ctx.get("my-state")) ?? "";
    },
  },
});

REGISTRY.addObject(c);

export type RecieverType = typeof c;
