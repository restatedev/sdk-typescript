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

// Tier 6: stopping work — three flavors.
//
// Maps to guide.md §"Cooperative cancellation with channels",
// §"Interrupting a task", §"Cancellation from outside the workflow", and
// §"Two kinds of cancellation".
//
// Demos:
//
//   pollWithStop      — workflow-internal COOPERATIVE stop. Spawn a
//                       polling worker; the parent caps total time via
//                       `sleep`, then calls `stop.send()` to wind it
//                       down. The worker observes the stop signal at its
//                       next select and returns null. Stop is in-band —
//                       only observed at a select point.
//
//   interruptWorker   — per-task FORCEFUL interrupt. `spawn` returns a
//                       Task; `task.interrupt(err)` throws `err` into the
//                       worker at its next yield, wherever it is parked
//                       (not only at a select). The worker catches it,
//                       runs cleanup, and we interrupt-then-join so the
//                       cleanup completes before returning.
//
//   cancellable       — invocation-level cancel. The handler waits on a
//                       long-running fake job and catches CancelledError
//                       to run a journaled cleanup step before re-throwing.
//                       Trigger via the Restate UI or `restate
//                       invocations cancel <id>` after kicking it off.

import * as restate from "@restatedev/restate-sdk";
import {
  service,
  spawn,
  run,
  sleep,
  select,
  channel,
  type Operation,
  type Channel,
} from "@restatedev/restate-sdk-gen";
import { getJob, slowFetch, type JobStatus } from "./fakes.js";

function pollWorker(
  jobId: string,
  stop: Channel<void>
): Operation<string | null> {
  return (function* () {
    let attempt = 0;
    while (true) {
      // Race the next poll against the stop channel.
      const r = yield* select({
        status: run(() => getJob(jobId), { name: `poll-${attempt}` }),
        stop: stop.receive,
      });
      if (r.tag === "stop") return null;
      const status: JobStatus = yield* r.future;
      if (status.state === "done") return status.result;
      if (status.state === "failed") {
        throw new restate.TerminalError(
          `job ${jobId} failed: ${status.reason}`
        );
      }
      attempt += 1;
      // Sleep before the next poll, but stay interruptible.
      const tick = yield* select({
        tick: sleep({ seconds: 1 }),
        stop: stop.receive,
      });
      if (tick.tag === "stop") return null;
    }
  })();
}

export const cancel = service({
  name: "cancel",
  handlers: {
    // Cooperative stop. Returns the job result if it completes within
    // budgetSeconds, or null if budget elapsed first.
    *pollWithStop(req: { jobId: string; budgetSeconds: number }) {
      const stop = channel<void>();
      const t = spawn(pollWorker(req.jobId, stop));

      const r = yield* select({
        done: t,
        budget: sleep({ seconds: req.budgetSeconds }),
      });

      if (r.tag === "budget") {
        // Budget elapsed — tell the worker to stop and wait for it to
        // wind down so we can read its clean result. (An un-awaited
        // worker would simply be abandoned at return under the default
        // `onMainExit: "abandon"`; here we await it for the result.)
        yield* stop.send();
      }
      return yield* t;
    },

    // Per-task interrupt — the forceful counterpart to pollWithStop.
    // The worker is parked deep inside a long `sleep`, where a stop
    // channel could not reach it (no select to observe). `interrupt`
    // throws into it there directly. The worker catches, runs cleanup,
    // and returns; we interrupt-then-join so the cleanup runs before we
    // return (under the default `onMainExit: "abandon"`, returning
    // without joining would abandon the worker before its catch).
    *interruptWorker(req: {
      jobId: string;
      budgetSeconds: number;
    }): Operation<string> {
      const worker = spawn(
        (function* (): Operation<string> {
          try {
            yield* sleep({ seconds: 60 }); // parked here when interrupted
            const status: JobStatus = yield* run(() => getJob(req.jobId), {
              name: "get",
            });
            return status.state === "done" ? status.result : "(no-result)";
          } catch (e) {
            // Interrupt is swallowable: clean up, then report instead of
            // propagating. (Re-throw `e` if you'd rather fail the task.)
            yield* run(
              async () => {
                console.log(`audit: worker for ${req.jobId} interrupted`);
              },
              { name: "audit-interrupt" }
            );
            return `interrupted: ${(e as Error).message}`;
          }
        })()
      );

      const r = yield* select({
        done: worker,
        budget: sleep({ seconds: req.budgetSeconds }),
      });
      if (r.tag === "done") return yield* r.future;

      worker.interrupt(new restate.TerminalError("over budget"));
      return yield* worker; // join: drive the worker's catch + cleanup
    },

    // Invocation cancel, version A — long `sleep`.
    // Cancel the invocation externally to see CancelledError surface at
    // the next yield. The catch runs an audit step before re-throwing.
    *cancellable(jobId: string): Operation<string> {
      try {
        // 60-second sleep stands in for any long-running journaled
        // work. Triggering invocation cancel surfaces here as
        // CancelledError thrown from yield*.
        yield* sleep({ seconds: 60 });
        const status: JobStatus = yield* run(() => getJob(jobId), {
          name: "get",
        });
        return status.state === "done" ? status.result : "(no-result)";
      } catch (e) {
        if (e instanceof restate.CancelledError) {
          // Cleanup yields work normally — cancellation is not
          // sticky once we've caught it.
          yield* run(
            async () => {
              console.log(`audit: ${jobId} cancelled at ${Date.now()}`);
            },
            { name: "audit-cancel" }
          );
          throw e;
        }
        throw e;
      }
    },

    // Invocation cancel, version B — AbortSignal plumbed into a long-
    // running closure. Each `run` closure receives `{ signal }`; pass it
    // into AbortSignal-aware APIs (real fetch, our fake slowFetch here)
    // so that invocation cancel aborts the syscall mid-flight instead
    // of waiting for it to finish on its own.
    //
    // Without the signal, the closure would run to completion and
    // CancelledError would only surface at the *next* yield AFTER the
    // closure returned — defeating the whole point of cancellation for
    // long-running closures. With the signal wired up, the fetch aborts
    // immediately when cancel arrives.
    //
    // Mechanics: on abort, slowFetch rejects with AbortError. The `run`
    // wrapper sees signal.aborted and re-throws the actual cancellation
    // reason (CancelledError) instead of the AbortError, so the journal
    // records a clean terminal outcome.
    *cancellableFetch(url: string): Operation<string> {
      try {
        return yield* run(({ signal }) => slowFetch(url, signal), {
          name: "fetch",
        });
      } catch (e) {
        if (e instanceof restate.CancelledError) {
          yield* run(
            async () => {
              console.log(`audit: fetch of ${url} aborted mid-flight`);
            },
            { name: "audit-cancel" }
          );
          throw e;
        }
        throw e;
      }
    },
  },
});
