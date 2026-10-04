/*
 * Copyright (c) 2023-2024 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

import { crashpoint, sideEffect } from "./crash.js";

export type ToolDefinition = {
  name: string;
  /**
   * `safe`: after a crash during the call, the call is executed again.
   * `unsafe`: after a crash during the call, the model gets an `interrupted` result instead.
   */
  replay: "safe" | "unsafe";
  execute(args: Record<string, unknown>): Promise<string>;
};

export const tools: Record<string, ToolDefinition> = {
  // Read-only: fine to execute again
  lookup: {
    name: "lookup",
    replay: "safe",
    execute: async (args) => {
      sideEffect("lookup");
      await new Promise((resolve) => setTimeout(resolve, 50));
      crashpoint("lookup");
      return `${String(args.item)} stock is 42`;
    },
  },
  // Not idempotent: must not be executed twice
  charge: {
    name: "charge",
    replay: "unsafe",
    execute: async (args) => {
      sideEffect("charge");
      // Dies after the effect happened, before reporting it
      crashpoint("charge");
      return `charged 10 EUR for ${String(args.item)}`;
    },
  },
  slow: {
    name: "slow",
    replay: "safe",
    execute: async () => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return "slow done";
    },
  },
};
