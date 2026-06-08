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

// task.interrupt(err) — throw `err` into a spawned routine at its next
// yield point.
//
// These are scheduler-level tests of the control-flow half of interrupt
// (the throw-at-yield). The I/O-promptness half (interrupt also aborts
// the routine's per-fiber run signal) needs a real `run` closure and is
// covered by the e2e suite.
//
// The critical correctness case here is the epoch guard: an interrupted
// routine leaves its park and re-parks elsewhere, but the local waiters
// it left on its old targets (sibling fibers, channels) are never
// pruned — they must not wake the moved-on routine with a stale value.

import { describe, expect, test } from "vitest";
import { gen, spawn, InterruptedError } from "../src/index.js";
import { Scheduler } from "../src/internal.js";
import { deferred, resolved, testLib } from "./test-promise.js";

describe("interrupt — basic delivery", () => {
  test("throws the exact error into the routine at its next yield; routine catches", async () => {
    const sched = new Scheduler(testLib);
    const d = deferred<string>();
    const boom = new Error("boom");
    const op = gen(function* () {
      const w = spawn(
        gen(function* () {
          try {
            yield* sched.makeJournalFuture(d.promise);
            return "completed";
          } catch (e) {
            return `caught:${(e as Error).message}:${e === boom}`;
          }
        })
      );
      yield* sched.makeJournalFuture(resolved("tick")); // let w park
      w.interrupt(boom);
      return yield* w;
    });
    expect(await sched.run(op)).toBe("caught:boom:true");
  });

  test("interrupt() with no argument throws a default InterruptedError", async () => {
    const sched = new Scheduler(testLib);
    const d = deferred<void>();
    const op = gen(function* () {
      const w = spawn(
        gen(function* () {
          try {
            yield* sched.makeJournalFuture(d.promise);
            return "completed";
          } catch (e) {
            return e instanceof InterruptedError ? "interrupted" : "other";
          }
        })
      );
      yield* sched.makeJournalFuture(resolved("tick"));
      w.interrupt();
      return yield* w;
    });
    expect(await sched.run(op)).toBe("interrupted");
  });

  test("an uncaught interrupt propagates verbatim to whoever awaits the task", async () => {
    const sched = new Scheduler(testLib);
    const d = deferred<void>();
    const boom = new Error("uncaught");
    const op = gen(function* () {
      const w = spawn(
        gen(function* () {
          // No try/catch — the interrupt propagates out of the routine.
          yield* sched.makeJournalFuture(d.promise);
          return "completed";
        })
      );
      yield* sched.makeJournalFuture(resolved("tick"));
      w.interrupt(boom);
      try {
        yield* w;
        return "no-throw";
      } catch (e) {
        return `joined-threw:${e === boom}`;
      }
    });
    expect(await sched.run(op)).toBe("joined-threw:true");
  });
});

describe("interrupt — swallow / recover / repeat", () => {
  test("a routine may catch the interrupt and continue normally", async () => {
    const sched = new Scheduler(testLib);
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    const op = gen(function* () {
      const w = spawn(
        gen(function* () {
          try {
            yield* sched.makeJournalFuture(d1.promise);
          } catch {
            // swallowed
          }
          const v = yield* sched.makeJournalFuture(d2.promise);
          return `recovered:${v}`;
        })
      );
      yield* sched.makeJournalFuture(resolved("tick"));
      w.interrupt(new Error("stop"));
      queueMicrotask(() => d2.resolve("after"));
      return yield* w;
    });
    expect(await sched.run(op)).toBe("recovered:after");
    d1.resolve("never-read");
  });

  test("double interrupt before the next advance is last-write-wins", async () => {
    const sched = new Scheduler(testLib);
    const d = deferred<void>();
    const op = gen(function* () {
      const w = spawn(
        gen(function* () {
          try {
            yield* sched.makeJournalFuture(d.promise);
            return "completed";
          } catch (e) {
            return `caught:${(e as Error).message}`;
          }
        })
      );
      yield* sched.makeJournalFuture(resolved("tick"));
      w.interrupt(new Error("first"));
      w.interrupt(new Error("second"));
      return yield* w;
    });
    expect(await sched.run(op)).toBe("caught:second");
  });

  test("interrupting an already-finished task is a no-op", async () => {
    const sched = new Scheduler(testLib);
    const op = gen(function* () {
      const w = spawn(
        gen(function* () {
          return "done-early";
        })
      );
      const v = yield* w; // drive w to completion
      w.interrupt(new Error("too late")); // no-op
      return `${v}:${yield* w}`; // re-yielding a done task gives the value
    });
    expect(await sched.run(op)).toBe("done-early:done-early");
  });
});

describe("interrupt — epoch guard against stale waiters", () => {
  test("interrupting a routine parked on a sibling, then re-parking, ignores the sibling's later completion", async () => {
    // W parks on sibling G (a local wait). Interrupt makes W catch and
    // re-park on H. Then G finishes — its waiter list still holds W's
    // pre-interrupt callback. Without the epoch guard that stale callback
    // would wake W with G's value and clobber the H park. With it, G's
    // completion is ignored and W resolves via H.
    const sched = new Scheduler(testLib);
    const dG = deferred<string>();
    const dH = deferred<string>();
    const events: string[] = [];

    const op = gen(function* () {
      const g = spawn(
        gen(function* () {
          return yield* sched.makeJournalFuture(dG.promise);
        })
      );
      const h = spawn(
        gen(function* () {
          return yield* sched.makeJournalFuture(dH.promise);
        })
      );
      const w = spawn(
        gen(function* () {
          try {
            const v = yield* g; // park on sibling G (local)
            events.push(`got-G:${v}`); // must NOT happen
            return `via-G:${v}`;
          } catch (e) {
            events.push(`interrupted:${(e as Error).message}`);
            const v = yield* h; // re-park on sibling H (local)
            events.push(`got-H:${v}`);
            return `via-H:${v}`;
          }
        })
      );

      yield* sched.makeJournalFuture(resolved("t1")); // let w park on g
      w.interrupt(new Error("stop")); // w catches, re-parks on h
      yield* sched.makeJournalFuture(resolved("t2")); // let w re-park
      dG.resolve("G-late"); // stale: must not wake w
      yield* sched.makeJournalFuture(resolved("t3")); // let g finish + fire stale waiter
      dH.resolve("H-val");
      const result = yield* w;
      return { result, events };
    });

    const out = await sched.run(op);
    expect(out.result).toBe("via-H:H-val");
    expect(out.events).toEqual(["interrupted:stop", "got-H:H-val"]);
  });

  test("interrupting a routine parked on a race, then re-racing, ignores a loser firing later", async () => {
    const sched = new Scheduler(testLib);
    const dA = deferred<string>();
    const dB = deferred<string>();
    const dC = deferred<string>();
    const events: string[] = [];

    const op = gen(function* () {
      const a = spawn(
        gen(function* () {
          return yield* sched.makeJournalFuture(dA.promise);
        })
      );
      const b = spawn(
        gen(function* () {
          return yield* sched.makeJournalFuture(dB.promise);
        })
      );
      const c = spawn(
        gen(function* () {
          return yield* sched.makeJournalFuture(dC.promise);
        })
      );
      const w = spawn(
        gen(function* () {
          try {
            const r = yield* sched.race([a, b]); // park on race of locals
            events.push(`race1:${r}`); // must NOT happen
            return r;
          } catch (e) {
            events.push(`interrupted:${(e as Error).message}`);
            return yield* sched.race([c]); // re-race
          }
        })
      );
      yield* sched.makeJournalFuture(resolved("t1"));
      w.interrupt(new Error("stop"));
      yield* sched.makeJournalFuture(resolved("t2"));
      dA.resolve("A-late"); // stale loser of the first race
      dB.resolve("B-late");
      yield* sched.makeJournalFuture(resolved("t3"));
      dC.resolve("C-val");
      const result = yield* w;
      return { result, events };
    });

    const out = await sched.run(op);
    expect(out.result).toBe("C-val");
    // race1 must never fire — the first race's losers are stale after interrupt.
    expect(out.events).toEqual(["interrupted:stop"]);
  });
});

describe("interrupt — interaction with onMainExit", () => {
  test("interrupt-then-join drives the routine through its finally (cleanup runs)", async () => {
    const sched = new Scheduler(testLib);
    const d = deferred<void>();
    let finallyRan = false;
    const op = gen(function* () {
      const w = spawn(
        gen(function* () {
          try {
            yield* sched.makeJournalFuture(d.promise);
            return "completed";
          } catch {
            return "interrupted";
          } finally {
            finallyRan = true;
          }
        })
      );
      yield* sched.makeJournalFuture(resolved("tick"));
      w.interrupt(new Error("stop"));
      const r = yield* w; // join: drive w to completion
      return `${r}:finally=${finallyRan}`;
    });
    expect(await sched.run(op)).toBe("interrupted:finally=true");
  });

  test("under default abandon, interrupt-then-return abandons the routine (finally does NOT run)", async () => {
    const sched = new Scheduler(testLib);
    const d = deferred<void>();
    let finallyRan = false;
    const op = gen(function* () {
      const w = spawn(
        gen(function* () {
          try {
            yield* sched.makeJournalFuture(d.promise);
          } finally {
            finallyRan = true; // never reached — w is abandoned
          }
        })
      );
      yield* sched.makeJournalFuture(resolved("tick")); // let w park
      w.interrupt(new Error("stop")); // marks w ready...
      return "main-done"; // ...but main settles first, w abandoned
    });
    expect(await sched.run(op)).toBe("main-done");
    expect(finallyRan).toBe(false);
    d.resolve();
  });

  test("under join, interrupt-then-return still drives the routine's finally", async () => {
    const sched = new Scheduler(testLib, undefined, { onMainExit: "join" });
    const d = deferred<void>();
    let finallyRan = false;
    const op = gen(function* () {
      const w = spawn(
        gen(function* () {
          try {
            yield* sched.makeJournalFuture(d.promise);
          } catch {
            // swallow
          } finally {
            finallyRan = true;
          }
        })
      );
      yield* sched.makeJournalFuture(resolved("tick"));
      w.interrupt(new Error("stop"));
      return "main-done";
    });
    expect(await sched.run(op)).toBe("main-done");
    expect(finallyRan).toBe(true);
  });
});
