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

import { service, serve, type Context } from "@restatedev/restate-sdk";
import { setTimeout } from "node:timers/promises";

const greeter = service({
  name: "greeter",
  handlers: {
    greet: async (ctx: Context, name: string) => {
      await setTimeout(5000);
      throw new Error("Bla");

      return `Hello ${name}`;
    },
  },
  options: {
    inactivityTimeout: { seconds: 1 },
    abortTimeout: { seconds: 1 },
  },
});

export type Greeter = typeof greeter;

serve({ services: [greeter] });
