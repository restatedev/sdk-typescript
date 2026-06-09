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

// task.interrupt e2e: against a real runtime, interrupting a spawned
// routine (1) throws the given error into it at its next yield and (2)
// aborts its in-flight `run` I/O — scoped to that fiber, so a sibling /
// the main fiber's own run signal is unaffected.
//
// The run-signal abort is by design invisible to workflow control flow
// (the interrupted fiber moves past the run), so we observe it through an
// in-process side channel: the test and the service run in the same Node
// process under RestateTestEnvironment, and a run closure records whether
// its signal fired. This channel is read only by the test, never by the
// handler, so replay determinism is unaffected. The per-fiber scoping is
// additionally asserted through a journaled value (the main fiber's own
// run reads `signal.aborted` and returns it).

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import {
  service,
  spawn,
  run,
  sleep,
  allSettled,
  type Operation,
  clients,
} from "@restatedev/restate-sdk-gen";

// Out-of-band observation channel (same process as the test).
const obs: Record<string, string> = {};

const waitForAbort = (signal: AbortSignal, key: string): Promise<string> =>
  new Promise<string>((resolve) => {
    if (signal.aborted) {
      obs[key] = "aborted";
      resolve("aborted");
      return;
    }
    signal.addEventListener("abort", () => {
      obs[key] = "aborted";
      resolve("aborted");
    });
    // Fallback so a missing abort fails fast rather than hanging the test.
    setTimeout(() => {
      obs[key] = "timeout";
      resolve("timeout");
    }, 5000);
  });

const interruptSvc = service({
  name: "interrupt",
  handlers: {
    // Interrupt a worker parked inside a `run`: the worker's per-fiber
    // signal aborts (recorded via obs.worker), and the thrown error is
    // delivered at the worker's yield (caught). The MAIN fiber's own run,
    // issued afterwards, sees an un-aborted signal — proving the abort is
    // scoped to the interrupted fiber, not global.
    *scopedInterrupt(): Operation<string> {
      const worker = spawn(
        (function* (): Operation<string> {
          try {
            yield* run(({ signal }) => waitForAbort(signal, "worker"), {
              name: "worker-run",
            });
            return "worker-completed";
          } catch (e) {
            return `worker-interrupted:${(e as Error).message}`;
          }
        })()
      );

      // Let the worker park inside its run closure before interrupting.
      yield* sleep(100);
      worker.interrupt(new Error("stop"));

      // Join: drive the worker through its catch.
      const [w] = yield* allSettled([worker]);
      const workerResult =
        w.status === "fulfilled" ? w.value : "worker-rejected";

      // The main fiber's own run must see an un-aborted signal (only the
      // worker was interrupted). Journaled → deterministic across replay.
      const mainAbortedAtStart = yield* run(
        async ({ signal }) => signal.aborted,
        { name: "main-run" }
      );

      return `${workerResult}|mainAbortedAtStart=${mainAbortedAtStart}`;
    },

    // Interrupt a worker parked on a real `sleep` (not a run). The sleep
    // command is created then thrown past; the handler completes promptly
    // (it does NOT wait out the sleep), and the abandoned sleep command
    // replays consistently under alwaysReplay.
    *interruptPastSleep(): Operation<string> {
      const w = spawn(
        (function* (): Operation<string> {
          try {
            yield* sleep(600000);
            return "completed";
          } catch (e) {
            return `interrupted:${(e as Error).message}`;
          }
        })()
      );
      yield* sleep(50);
      w.interrupt(new Error("stop"));
      const [r] = yield* allSettled([w]);
      return r.status === "fulfilled" ? r.value : "rejected";
    },

    // Interrupt-then-join with journaled cleanup: the worker is interrupted
    // mid-sleep, its catch runs a `run` (audit/cleanup), and returns. The
    // cleanup journal entry must be created and replay deterministically.
    *interruptThenJoinCleanup(): Operation<string> {
      const w = spawn(
        (function* (): Operation<string> {
          try {
            yield* sleep(600000);
            return "completed";
          } catch (e) {
            const audited = yield* run(async () => "audited", {
              name: "cleanup",
            });
            return `interrupted:${(e as Error).message}:${audited}`;
          }
        })()
      );
      yield* sleep(50);
      w.interrupt(new Error("stop"));
      return yield* w; // join: drives the worker through its catch + cleanup
    },

    // An uncaught interrupt fails the routine; the joiner observes the
    // verbatim error via allSettled. Replay-stable.
    *uncaughtInterruptFails(): Operation<string> {
      const w = spawn(
        (function* (): Operation<string> {
          yield* sleep(600000); // no try/catch
          return "completed";
        })()
      );
      yield* sleep(50);
      w.interrupt(new Error("boom"));
      const [r] = yield* allSettled([w]);
      return r.status === "rejected"
        ? `rejected:${(r.reason as Error).message}`
        : `fulfilled:${r.value}`;
    },

    // Interrupt mid-run, error identity under replay: the worker's run
    // closure rejects on signal-abort; the interrupt also wakes the
    // worker with the verbatim error. The caught error must be identical
    // record vs replay (the per-tick lib.race is a journaled combinator,
    // so the interrupt-vs-run-resolution ordering is stable).
    *interruptMidRunErrorIdentity(): Operation<string> {
      const w = spawn(
        (function* (): Operation<string> {
          try {
            yield* run(
              ({ signal }) =>
                new Promise<string>((resolve, reject) => {
                  signal.addEventListener("abort", () =>
                    reject(signal.reason as Error)
                  );
                  setTimeout(() => resolve("never"), 5000);
                }),
              { name: "io" }
            );
            return "completed";
          } catch (e) {
            const err = e as Error;
            return `caught:${err.name}:${err.message}`;
          }
        })()
      );
      yield* sleep(50);
      w.interrupt(); // no-arg → default InterruptedError
      return yield* w;
    },

    // Interrupt before the worker's first advance: spawn then interrupt
    // with no intervening yield. The throw must still land inside the
    // worker's body (caught) and replay consistently — the body is primed
    // to its first yield before the throw is delivered.
    *interruptBeforeFirstAdvance(): Operation<string> {
      const w = spawn(
        (function* (): Operation<string> {
          try {
            yield* sleep(600000);
            return "completed";
          } catch (e) {
            const audited = yield* run(async () => "audited", {
              name: "pre-start-cleanup",
            });
            return `interrupted:${(e as Error).message}:${audited}`;
          }
        })()
      );
      w.interrupt(new Error("pre-start")); // no yield between spawn and interrupt
      return yield* w;
    },

    // Self-interrupt: a worker interrupts its own task, then yields. The
    // throw must land at that yield (delivered via the advance-loop's
    // re-entrant-wake detection) and replay consistently.
    *selfInterrupt(): Operation<string> {
      const holder: { self?: { interrupt(err?: unknown): void } } = {};
      const w = spawn(
        (function* (): Operation<string> {
          try {
            holder.self?.interrupt(new Error("self"));
            yield* sleep(600000);
            return "completed";
          } catch (e) {
            const audited = yield* run(async () => "audited", {
              name: "self-cleanup",
            });
            return `interrupted:${(e as Error).message}:${audited}`;
          }
        })()
      );
      holder.self = w;
      yield* sleep(50);
      return yield* w;
    },

    // Cascade: interrupting a parent task also interrupts the child it
    // spawned. Both catch and run journaled cleanup; the parent joins the
    // child to read its result. The cleanup command sequence must replay
    // consistently under alwaysReplay.
    *cascadeInterrupt(): Operation<string> {
      const parent = spawn(
        (function* (): Operation<string> {
          const child = spawn(
            (function* (): Operation<string> {
              try {
                yield* sleep(600000);
                return "child-completed";
              } catch (e) {
                const a = yield* run(async () => "child-cleaned", {
                  name: "child-cleanup",
                });
                return `child:${(e as Error).message}:${a}`;
              }
            })()
          );
          try {
            yield* sleep(600000);
            return "parent-completed";
          } catch (e) {
            const a = yield* run(async () => "parent-cleaned", {
              name: "parent-cleanup",
            });
            const cr = yield* child; // child was interrupted via the cascade
            return `parent:${(e as Error).message}:${a}|${cr}`;
          }
        })()
      );
      yield* sleep(50);
      parent.interrupt(new Error("boom")); // cascades to child
      return yield* parent;
    },

    // Combinator + interrupt at the journal level: interrupt one input of
    // an allSettled; it is recorded rejected, the other fulfilled.
    *interruptCombinatorInput(): Operation<string> {
      const t1 = spawn(
        (function* (): Operation<string> {
          yield* sleep(600000); // interrupted, uncaught → rejects
          return "t1";
        })()
      );
      const t2 = spawn(
        (function* (): Operation<string> {
          return yield* run(async () => "two", { name: "t2" });
        })()
      );
      yield* sleep(50);
      t1.interrupt(new Error("boom"));
      const [r1, r2] = yield* allSettled([t1, t2]);
      const s1 =
        r1.status === "rejected"
          ? `rej:${(r1.reason as Error).message}`
          : `ok:${r1.value}`;
      const s2 = r2.status === "fulfilled" ? `ok:${r2.value}` : "rej";
      return `${s1}|${s2}`;
    },
  },
});

const modes = [
  { name: "default", alwaysReplay: false },
  { name: "alwaysReplay", alwaysReplay: true },
] as const;

describe.each(modes)("interrupt — $name mode", ({ alwaysReplay }) => {
  let env: RestateTestEnvironment;
  let ingress: clients.GenIngress;

  beforeAll(async () => {
    env = await RestateTestEnvironment.start({
      services: [interruptSvc],
      alwaysReplay,
    });
    ingress = clients.connect({ url: env.baseUrl() });
  });

  afterAll(async () => {
    await env?.stop();
  });

  test("interrupt past a sleep: handler completes promptly, sleep command abandoned", async () => {
    const c = clients.client(ingress, interruptSvc);
    expect(await c.interruptPastSleep()).toBe("interrupted:stop");
  });

  test("interrupt-then-join runs journaled cleanup in the catch", async () => {
    const c = clients.client(ingress, interruptSvc);
    expect(await c.interruptThenJoinCleanup()).toBe("interrupted:stop:audited");
  });

  test("uncaught interrupt fails the routine; joiner sees the verbatim error", async () => {
    const c = clients.client(ingress, interruptSvc);
    expect(await c.uncaughtInterruptFails()).toBe("rejected:boom");
  });

  test("interrupting one input of allSettled: rejected for it, fulfilled for the other", async () => {
    const c = clients.client(ingress, interruptSvc);
    expect(await c.interruptCombinatorInput()).toBe("rej:boom|ok:two");
  });

  test("interrupt cascades to a spawned child; both run journaled cleanup", async () => {
    const c = clients.client(ingress, interruptSvc);
    expect(await c.cascadeInterrupt()).toBe(
      "parent:boom:parent-cleaned|child:boom:child-cleaned"
    );
  });

  test("self-interrupt: the throw lands at the worker's next yield and replays consistently", async () => {
    const c = clients.client(ingress, interruptSvc);
    expect(await c.selfInterrupt()).toBe("interrupted:self:audited");
  });

  test("interrupt before first advance is caught inside the worker and replays consistently", async () => {
    const c = clients.client(ingress, interruptSvc);
    expect(await c.interruptBeforeFirstAdvance()).toBe(
      "interrupted:pre-start:audited"
    );
  });

  test("interrupt mid-run: the caught error is the verbatim interrupt error, identical record vs replay", async () => {
    const c = clients.client(ingress, interruptSvc);
    // The in-memory interrupt wake (verbatim InterruptedError) wins over
    // the run's journaled (coerced) outcome; the per-tick journaled race
    // combinator keeps this ordering stable across replay.
    expect(await c.interruptMidRunErrorIdentity()).toBe(
      "caught:InterruptedError:Task interrupted"
    );
  });

  test("interrupt aborts the worker's run signal and delivers the error; main's signal is unaffected", async () => {
    obs.worker = "init";
    const client = clients.client(ingress, interruptSvc);
    const result = await client.scopedInterrupt();
    expect(result).toBe("worker-interrupted:stop|mainAbortedAtStart=false");
    // The worker's in-flight run signal fired (scoped per fiber).
    expect(obs.worker).toBe("aborted");
  });
});
