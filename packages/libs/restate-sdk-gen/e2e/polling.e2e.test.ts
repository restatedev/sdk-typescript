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

// Polling + cooperative-cancel e2e.
//
// pollUntilDone: a polling loop with deterministic counter-named journal
// entries. The job's "done-ness" is queried, not mutated, so replay
// behavior is fully deterministic — alwaysReplay mode catches any
// non-determinism in entry naming or control flow.
//
// pollWithStop: spawn a polling worker, race against a budget timer,
// signal stop on budget elapse via Channel<void>. Tested in default
// mode only — channel state lives in JS memory only and does not
// survive the suspend/replay cycle that alwaysReplay forces, so the
// "stop fires" path is inherently non-deterministic under alwaysReplay.
// We test the "worker finishes first" path under both modes since it
// doesn't depend on channel-stop survival.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import {
  service,
  spawn,
  run,
  sleep,
  channel,
  select,
  type Operation,
  type Channel,
  clients,
} from "@restatedev/restate-sdk-gen";

// Job state is read-only from the polling closure's perspective: a
// background timer flips `done` exactly once. Calling takePoll multiple
// times (whether due to retries, replays, or alwaysReplay's repeated
// fresh entries) doesn't change anything.
type Job = { done: boolean; result: string };
const jobs = new Map<string, Job>();

function startJob(jobId: string, completeAfterMs: number, result: string) {
  const job: Job = { done: false, result };
  jobs.set(jobId, job);
  if (completeAfterMs >= 0) {
    setTimeout(() => {
      job.done = true;
    }, completeAfterMs);
  }
  // completeAfterMs < 0 → never completes
}

function takePoll(jobId: string): string {
  const j = jobs.get(jobId);
  if (!j || !j.done) return "pending";
  return j.result;
}

function pollWorker(
  jobId: string,
  stop: Channel<void>
): Operation<string | null> {
  return (function* () {
    let attempt = 0;
    while (true) {
      const r = yield* select({
        status: run(async () => takePoll(jobId), { name: `poll-${attempt}` }),
        stop: stop.receive,
      });
      if (r.tag === "stop") return null;
      const status = yield* r.future;
      if (status !== "pending") return status;
      attempt += 1;
      const tick = yield* select({
        tick: sleep({ milliseconds: 100 }),
        stop: stop.receive,
      });
      if (tick.tag === "stop") return null;
    }
  })();
}

const pollingSvc = service({
  name: "polling",
  handlers: {
    *pollUntilDone(jobId: string): Operation<string> {
      let attempt = 0;
      while (true) {
        const status = yield* run(async () => takePoll(jobId), {
          name: `poll-${attempt}`,
        });
        if (status !== "pending") return status;
        attempt += 1;
        yield* sleep({ milliseconds: 100 });
      }
    },

    *pollWithStop(req: { jobId: string; budgetMs: number }) {
      const stop = channel<void>();
      const t = yield* spawn(pollWorker(req.jobId, stop));
      const r = yield* select({
        done: t,
        budget: sleep({ milliseconds: req.budgetMs }),
      });
      if (r.tag === "budget") {
        yield* stop.send();
      }
      return yield* t;
    },
  },
});

const modes = [
  { name: "default", alwaysReplay: false },
  { name: "alwaysReplay", alwaysReplay: true },
] as const;

describe.each(modes)("polling — $name mode", ({ alwaysReplay }) => {
  let env: RestateTestEnvironment;
  let ingress: clients.Ingress;

  beforeAll(async () => {
    env = await RestateTestEnvironment.start({
      services: [pollingSvc],
      alwaysReplay,
    });
    ingress = clients.connect({ url: env.baseUrl() });
  });

  afterAll(async () => {
    await env?.stop();
  });

  test("pollUntilDone: completes after the job finishes", async () => {
    const jobId = `poll-${alwaysReplay ? "replay" : "default"}`;
    startJob(jobId, 200, "complete");
    const client = clients.client(ingress, pollingSvc);
    expect(await client.pollUntilDone(jobId)).toBe("complete");
  });

  test("pollWithStop: worker returns the result before budget elapses", async () => {
    const jobId = `stop-fast-${alwaysReplay ? "replay" : "default"}`;
    startJob(jobId, 100, "got-it");
    const client = clients.client(ingress, pollingSvc);
    expect(await client.pollWithStop({ jobId, budgetMs: 5_000 })).toBe(
      "got-it"
    );
  });
});

describe.each(modes)(
  "polling — channel-based stop — $name mode",
  ({ alwaysReplay }) => {
    let env: RestateTestEnvironment;
    let ingress: clients.Ingress;

    beforeAll(async () => {
      env = await RestateTestEnvironment.start({
        services: [pollingSvc],
        alwaysReplay,
      });
      ingress = clients.connect({ url: env.baseUrl() });
    });

    afterAll(async () => {
      await env?.stop();
    });

    test("budget elapses → stop fires → worker returns null", async () => {
      // Worker keeps polling forever (job never completes). After the
      // budget elapses, the parent calls stop.send(); the worker
      // observes stop on its next select and returns null.
      //
      // Channels are pure scheduler primitives — receive is local-
      // backed (a WaitTarget), not journal-backed — so the stop signal
      // is delivered without involving RestatePromise.race and survives
      // alwaysReplay correctly: each replay re-enters the parent body,
      // which after budget wins re-issues stop.send() against the
      // freshly-constructed channel.
      const jobId = `stop-never-${alwaysReplay ? "replay" : "default"}`;
      startJob(jobId, -1, "never-seen");
      const client = clients.client(ingress, pollingSvc);
      expect(await client.pollWithStop({ jobId, budgetMs: 250 })).toBeNull();
    });
  }
);
