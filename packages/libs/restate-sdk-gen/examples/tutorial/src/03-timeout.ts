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

// Tier 3: timeouts via select(work, sleep).
//
// Maps to guide.md §Timeouts. The pattern: race the work future against
// a `sleep`, branch on which won. The losing future keeps running in
// the background — its result (if any) is discarded.
//
// To actually cancel a slow call, plumb the AbortSignal that `run`
// closures receive into your fetch/etc. — see retry.ts and the §"Don't
// forget that `run` closures continue past cancellation" gotcha in
// the guide.

import * as restate from "@restatedev/restate-sdk";
import {
  service,
  run,
  sleep,
  select,
  type Operation,
} from "@restatedev/restate-sdk-gen";
import { wait } from "./fakes.js";

export const timeout = service({
  name: "timeout",
  handlers: {
    *withTimeout(req: {
      workMs: number;
      budgetSeconds: number;
    }): Operation<string> {
      const r = yield* select({
        done: run(
          async () => {
            await wait(req.workMs);
            return `did-${req.workMs}ms-of-work`;
          },
          { name: "call" }
        ),
        timeout: sleep({ seconds: req.budgetSeconds }),
      });
      if (r.tag === "timeout") {
        throw new restate.TerminalError(
          `timed out after ${req.budgetSeconds}s`
        );
      }
      return yield* r.future;
    },
  },
});
