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

import {
  service,
  endpoint,
  handlers,
  type Context,
} from "@restatedev/restate-sdk";

const greeter = service({
  name: "greeter",
  handlers: {
    greet: handlers.handler(
      {
        journalRetention: { days: 1 },
      },
      async (ctx: Context, name: string) => {
        return `Hello ${name}`;
      }
    ),
  },
  options: {
    journalRetention: { days: 2 },
  },
});

export type Greeter = typeof greeter;

endpoint().bind(greeter).listen();
