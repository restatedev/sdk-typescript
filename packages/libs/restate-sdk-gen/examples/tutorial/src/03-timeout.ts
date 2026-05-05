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
import { gen, execute, run, sleep, select } from "@restatedev/restate-sdk-gen";
import { wait } from "./fakes.js";

export const timeout = restate.service({
  name: "timeout",
  handlers: {
    withTimeout: async (
      ctx: restate.Context,
      req: { workMs: number; budgetSeconds: number }
    ): Promise<string> =>
      execute(
        ctx,
        gen(function* () {
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
        })
      ),
  },
});
