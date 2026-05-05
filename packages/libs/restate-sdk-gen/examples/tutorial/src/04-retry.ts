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

// Tier 4: bounded retries with TerminalError fallback.
//
// Maps to guide.md §Retries. The SDK's ctx.run already retries on non-
// terminal errors with backoff. Pass options to bound the retries; if
// the bound is hit, the SDK throws TerminalError and you can catch for
// a fallback.
//
// Don't write user-level retry loops on top of `run` unless you need
// control flow the policy can't express (e.g. switch endpoints after N
// failures, check external state between attempts).

import * as restate from "@restatedev/restate-sdk";
import { gen, execute, run } from "@restatedev/restate-sdk-gen";
import { flakyFetch } from "./fakes.js";

export const retry = restate.service({
  name: "retry",
  handlers: {
    // The closure throws non-terminal errors a few times before
    // succeeding. With retry.maxAttempts: 5, the SDK retries with
    // backoff and the call eventually succeeds (since flakyFetch fails
    // only twice).
    bounded: async (ctx: restate.Context, url: string): Promise<string> =>
      execute(
        ctx,
        gen(function* () {
          try {
            return yield* run(() => flakyFetch(url, 2), {
              name: "fetch",
              retry: { maxAttempts: 5, initialInterval: { milliseconds: 100 } },
            });
          } catch (e) {
            if (e instanceof restate.TerminalError) {
              // Bound exhausted (or upstream returned a terminal error).
              // Fall back to a static value. In real code you'd pick
              // your own fallback, log, or rethrow with context.
              return `fallback-for-${url}`;
            }
            throw e;
          }
        })
      ),
  },
});
