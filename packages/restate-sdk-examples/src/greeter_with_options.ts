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
  TerminalError,
  type Context,
} from "@restatedev/restate-sdk";

class MyValidationError extends Error {}

const greeter = service({
  name: "greeter",
  handlers: {
    greet: handlers.handler(
      {
        journalRetention: { days: 1 },
      },
      async (ctx: Context, name: string) => {
        if (name.length === 0) {
          throw new MyValidationError("Name length is 0");
        }
        return `Hello ${name}`;
      }
    ),
  },
  options: {
    journalRetention: { days: 2 },
    asTerminalError: (err) => {
      if (err instanceof MyValidationError) {
        // My validation error is terminal
        return new TerminalError(err.message, { errorCode: 400 });
      }

      // Any other error is retryable
    },
  },
});

export type Greeter = typeof greeter;

endpoint()
  .bind(greeter)
  .defaultServiceOptions({
    // You can configure default service options that will be applied to every service.
    journalRetention: { days: 10 },
  })
  .listen();
