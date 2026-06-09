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
// Coverage is organized by concern: basic delivery, control flow
// (throw/catch/finally/rethrow/repeat), same-tick precedence, the epoch
// guard against stale waiters, termination / no-deadlock, onMainExit
// interaction, Task composition, and determinism.

import { describe, expect, test } from "vitest";
import {
  gen,
  spawn,
  select,
  InterruptedError,
  type Operation,
  type Future,
} from "../src/index.js";
import { Scheduler } from "../src/internal.js";
import { cancellingLib, deferred, resolved, testLib } from "./test-promise.js";

// "Let pending ready fibers run and park" — yield a pre-resolved journal
// future so the current fiber suspends for one drain.
const tick = (sched: Scheduler): Future<string> =>
  sched.makeJournalFuture(resolved("tick"));

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
      yield* tick(sched); // let w park
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
      yield* tick(sched);
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
      yield* tick(sched);
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

describe("interrupt — before the routine's first advance", () => {
  // `spawn` queues a fiber ready but does not advance it until the next
  // drain. Interrupting it before that first advance (no yield between
  // spawn and interrupt) must still deliver the throw INSIDE the body —
  // its try/catch/finally apply — not propagate uncaught from a
  // suspended-at-start generator.

  test("interrupt before first advance is caught (delivered at the first yield)", async () => {
    const sched = new Scheduler(testLib);
    const events: string[] = [];
    const op = gen(function* () {
      const w = spawn(
        gen(function* () {
          events.push("body");
          try {
            yield* sched.makeJournalFuture(deferred<void>().promise);
            return "completed";
          } catch (e) {
            return `caught:${(e as Error).message}`;
          }
        })
      );
      w.interrupt(new Error("pre-start")); // NO yield between spawn and interrupt
      return yield* w;
    });
    const result = await sched.run(op);
    expect(result).toBe("caught:pre-start");
    expect(events).toEqual(["body"]); // body actually ran (up to the first yield)
  });

  test("interrupt before first advance under join still runs the routine's finally", async () => {
    const sched = new Scheduler(testLib, undefined, { onMainExit: "join" });
    let finallyRan = false;
    const op = gen(function* () {
      const w = spawn(
        gen(function* () {
          try {
            yield* sched.makeJournalFuture(deferred<void>().promise);
          } catch {
            // swallow
          } finally {
            finallyRan = true;
          }
        })
      );
      w.interrupt(new Error("pre-start"));
      return "main-done";
    });
    expect(await sched.run(op)).toBe("main-done");
    expect(finallyRan).toBe(true);
  });

  test("interrupt before first advance on a body that returns before yielding is moot", async () => {
    const sched = new Scheduler(testLib);
    const op = gen(function* () {
      const w = spawn(
        gen(function* () {
          return "no-yield"; // returns before any yield — no point to throw at
        })
      );
      w.interrupt(new Error("pre-start"));
      return yield* w;
    });
    expect(await sched.run(op)).toBe("no-yield");
  });

  test("uncaught interrupt before first advance fails the routine with the verbatim error", async () => {
    const sched = new Scheduler(testLib);
    const op = gen(function* () {
      const w = spawn(
        gen(function* () {
          // No try/catch — runs to the first yield, then the interrupt.
          yield* sched.makeJournalFuture(deferred<void>().promise);
          return "completed";
        })
      );
      w.interrupt(new Error("pre-start"));
      try {
        yield* w;
        return "no-throw";
      } catch (e) {
        return `joined-threw:${(e as Error).message}`;
      }
    });
    expect(await sched.run(op)).toBe("joined-threw:pre-start");
  });
});

describe("interrupt — control flow", () => {
  test("the thrown error propagates through a nested yield* (delegation)", async () => {
    const sched = new Scheduler(testLib);
    const d = deferred<string>();
    const helper = (): Operation<string> =>
      gen(function* () {
        // Parks here; the interrupt is thrown in at this delegated yield.
        return yield* sched.makeJournalFuture(d.promise);
      });
    const op = gen(function* () {
      const w = spawn(
        gen(function* () {
          try {
            return yield* helper();
          } catch (e) {
            return `outer-caught:${(e as Error).message}`;
          }
        })
      );
      yield* tick(sched);
      w.interrupt(new Error("boom"));
      return yield* w;
    });
    expect(await sched.run(op)).toBe("outer-caught:boom");
  });

  test("try/finally with no catch: finally runs, then the error propagates", async () => {
    const sched = new Scheduler(testLib);
    const d = deferred<void>();
    let finallyRan = false;
    const op = gen(function* () {
      const w = spawn(
        gen(function* () {
          try {
            yield* sched.makeJournalFuture(d.promise);
            return "completed";
          } finally {
            finallyRan = true;
          }
        })
      );
      yield* tick(sched);
      w.interrupt(new Error("boom"));
      try {
        yield* w;
        return "no-throw";
      } catch (e) {
        return `threw:${(e as Error).message}:finally=${finallyRan}`;
      }
    });
    expect(await sched.run(op)).toBe("threw:boom:finally=true");
  });

  test("a finally that yields journaled cleanup completes before the error propagates", async () => {
    const sched = new Scheduler(testLib);
    const dWork = deferred<void>();
    const dCleanup = deferred<string>();
    let cleanupValue = "";
    const op = gen(function* () {
      const w = spawn(
        gen(function* () {
          try {
            yield* sched.makeJournalFuture(dWork.promise);
            return "completed";
          } finally {
            // The interrupt is pending; this cleanup yield must be driven
            // to completion before the throw resumes propagating.
            cleanupValue = yield* sched.makeJournalFuture(dCleanup.promise);
          }
        })
      );
      yield* tick(sched);
      w.interrupt(new Error("boom"));
      queueMicrotask(() => dCleanup.resolve("cleaned"));
      try {
        yield* w;
        return "no-throw";
      } catch (e) {
        return `threw:${(e as Error).message}:cleanup=${cleanupValue}`;
      }
    });
    expect(await sched.run(op)).toBe("threw:boom:cleanup=cleaned");
    dWork.resolve();
  });

  test("catch and rethrow a different error", async () => {
    const sched = new Scheduler(testLib);
    const d = deferred<void>();
    const op = gen(function* () {
      const w = spawn(
        gen(function* () {
          try {
            yield* sched.makeJournalFuture(d.promise);
            return "completed";
          } catch (e) {
            throw new Error(`wrapped:${(e as Error).message}`);
          }
        })
      );
      yield* tick(sched);
      w.interrupt(new Error("boom"));
      try {
        yield* w;
        return "no-throw";
      } catch (e) {
        return (e as Error).message;
      }
    });
    expect(await sched.run(op)).toBe("wrapped:boom");
  });

  test("sequential interrupts: caught, recovered, interrupted again, recovered again", async () => {
    const sched = new Scheduler(testLib);
    const d1 = deferred<void>();
    const d2 = deferred<void>();
    const d3 = deferred<string>();
    const events: string[] = [];
    const op = gen(function* () {
      const w = spawn(
        gen(function* () {
          try {
            yield* sched.makeJournalFuture(d1.promise);
          } catch (e) {
            events.push(`int1:${(e as Error).message}`);
          }
          try {
            yield* sched.makeJournalFuture(d2.promise);
          } catch (e) {
            events.push(`int2:${(e as Error).message}`);
          }
          return yield* sched.makeJournalFuture(d3.promise);
        })
      );
      yield* tick(sched);
      w.interrupt(new Error("one")); // caught by first try
      yield* tick(sched); // let w re-park on d2
      w.interrupt(new Error("two")); // caught by second try
      queueMicrotask(() => d3.resolve("done"));
      const result = yield* w;
      return { result, events };
    });
    const out = await sched.run(op);
    expect(out.result).toBe("done");
    expect(out.events).toEqual(["int1:one", "int2:two"]);
    d1.resolve();
    d2.resolve();
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
      yield* tick(sched);
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
      yield* tick(sched);
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
      w.interrupt(); // still a no-op
      return `${v}:${yield* w}`; // re-yielding a done task gives the value
    });
    expect(await sched.run(op)).toBe("done-early:done-early");
  });
});

describe("interrupt — self-interrupt", () => {
  // A fiber interrupting its OWN task while it is the currently-advancing
  // fiber. The throw must be delivered at the fiber's next yield, uniform
  // with interrupting any other task — even though the wake fires
  // re-entrantly during the fiber's own advance.

  test("self-interrupt then yield a resolvable source: the interrupt wins at that yield", async () => {
    const sched = new Scheduler(testLib);
    const d = deferred<string>();
    const holder: { self?: { interrupt(err?: unknown): void } } = {};
    const op = gen(function* () {
      const w = spawn(
        gen(function* () {
          try {
            holder.self?.interrupt(new Error("self"));
            const v = yield* sched.makeJournalFuture(d.promise);
            return `completed:${v}`; // must NOT happen
          } catch (e) {
            return `caught:${(e as Error).message}`;
          }
        })
      );
      holder.self = w;
      yield* tick(sched);
      queueMicrotask(() => d.resolve("val"));
      return yield* w;
    });
    expect(await sched.run(op)).toBe("caught:self");
  });

  test("self-interrupt then yield a never-resolving source: terminates via catch (no hang)", async () => {
    const sched = new Scheduler(testLib);
    const never = deferred<string>();
    const holder: { self?: { interrupt(err?: unknown): void } } = {};
    const op = gen(function* () {
      const w = spawn(
        gen(function* () {
          try {
            holder.self?.interrupt(new Error("self"));
            const v = yield* sched.makeJournalFuture(never.promise);
            return `completed:${v}`;
          } catch (e) {
            return `caught:${(e as Error).message}`;
          }
        })
      );
      holder.self = w;
      yield* tick(sched);
      return yield* w; // must terminate
    });
    expect(await sched.run(op)).toBe("caught:self");
  });

  test("self-interrupt with no further yield is moot (the fiber returns normally)", async () => {
    const sched = new Scheduler(testLib);
    const holder: { self?: { interrupt(err?: unknown): void } } = {};
    const op = gen(function* () {
      const w = spawn(
        gen(function* () {
          holder.self?.interrupt(new Error("self"));
          return "completed"; // no yield after the interrupt → nothing to throw at
        })
      );
      holder.self = w;
      yield* tick(sched);
      return yield* w;
    });
    expect(await sched.run(op)).toBe("completed");
  });

  test("no-arg self-interrupt throws the default InterruptedError at the next yield", async () => {
    const sched = new Scheduler(testLib);
    const d = deferred<void>();
    const holder: { self?: { interrupt(err?: unknown): void } } = {};
    const op = gen(function* () {
      const w = spawn(
        gen(function* () {
          try {
            holder.self?.interrupt();
            yield* sched.makeJournalFuture(d.promise);
            return "completed";
          } catch (e) {
            return e instanceof InterruptedError ? "interrupted" : "other";
          }
        })
      );
      holder.self = w;
      yield* tick(sched);
      return yield* w;
    });
    expect(await sched.run(op)).toBe("interrupted");
    d.resolve();
  });

  test("self-interrupt can be caught and recovered from", async () => {
    const sched = new Scheduler(testLib);
    const d = deferred<void>();
    const recover = deferred<string>();
    const holder: { self?: { interrupt(err?: unknown): void } } = {};
    const op = gen(function* () {
      const w = spawn(
        gen(function* () {
          try {
            holder.self?.interrupt(new Error("self"));
            yield* sched.makeJournalFuture(d.promise);
          } catch {
            // swallowed
          }
          return yield* sched.makeJournalFuture(recover.promise);
        })
      );
      holder.self = w;
      yield* tick(sched);
      queueMicrotask(() => recover.resolve("recovered"));
      return yield* w;
    });
    expect(await sched.run(op)).toBe("recovered");
    d.resolve();
  });

  test("sync work after a self-interrupt runs; the throw lands at the following yield", async () => {
    const sched = new Scheduler(testLib);
    const d = deferred<void>();
    const events: string[] = [];
    const holder: { self?: { interrupt(err?: unknown): void } } = {};
    const op = gen(function* () {
      const w = spawn(
        gen(function* () {
          try {
            holder.self?.interrupt(new Error("self"));
            events.push("after-interrupt-sync"); // sync work still runs
            yield* sched.makeJournalFuture(d.promise);
            events.push("after-yield"); // must NOT happen
            return "completed";
          } catch (e) {
            return `caught:${(e as Error).message}`;
          }
        })
      );
      holder.self = w;
      yield* tick(sched);
      const result = yield* w;
      return { result, events };
    });
    const out = await sched.run(op);
    expect(out.result).toBe("caught:self");
    expect(out.events).toEqual(["after-interrupt-sync"]);
    d.resolve();
  });
});

describe("interrupt — same-tick precedence", () => {
  test("a routine handed a value then interrupted in the same advance: interrupt wins", async () => {
    // The sender wakes the receiver with the channel value, then interrupts
    // it — both inside the sender's synchronous advance, before the receiver
    // runs. The receiver must observe the interrupt error, not the value.
    const sched = new Scheduler(testLib);
    const ch = sched.makeChannel<string>();
    const events: string[] = [];
    const op = gen(function* () {
      const w = spawn(
        gen(function* () {
          try {
            const v = yield* ch.receive;
            events.push(`received:${v}`); // must NOT happen
            return `value:${v}`;
          } catch (e) {
            return `interrupted:${(e as Error).message}`;
          }
        })
      );
      yield* tick(sched); // let w park on ch.receive
      yield* ch.send("hello"); // wakes w with the value (synchronous)
      w.interrupt(new Error("boom")); // overwrites the pending value
      const result = yield* w;
      return { result, events };
    });
    const out = await sched.run(op);
    expect(out.result).toBe("interrupted:boom");
    expect(out.events).toEqual([]);
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

      yield* tick(sched); // let w park on g
      w.interrupt(new Error("stop")); // w catches, re-parks on h
      yield* tick(sched); // let w re-park
      dG.resolve("G-late"); // stale: must not wake w
      yield* tick(sched); // let g finish + fire stale waiter
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
      yield* tick(sched);
      w.interrupt(new Error("stop"));
      yield* tick(sched);
      dA.resolve("A-late"); // stale loser of the first race
      dB.resolve("B-late");
      yield* tick(sched);
      dC.resolve("C-val");
      const result = yield* w;
      return { result, events };
    });

    const out = await sched.run(op);
    expect(out.result).toBe("C-val");
    // race1 must never fire — the first race's losers are stale after interrupt.
    expect(out.events).toEqual(["interrupted:stop"]);
  });

  test("interrupting a routine parked on a channel, then re-parking, ignores a later send on the old channel", async () => {
    const sched = new Scheduler(testLib);
    const chOld = sched.makeChannel<string>();
    const chNew = sched.makeChannel<string>();
    const events: string[] = [];
    const op = gen(function* () {
      const w = spawn(
        gen(function* () {
          try {
            const v = yield* chOld.receive; // park on old channel (local)
            events.push(`old:${v}`); // must NOT happen
            return `old:${v}`;
          } catch (e) {
            events.push(`interrupted:${(e as Error).message}`);
            const v = yield* chNew.receive; // re-park on new channel
            return `new:${v}`;
          }
        })
      );
      yield* tick(sched); // let w park on chOld
      w.interrupt(new Error("stop")); // w catches, re-parks on chNew
      yield* tick(sched); // let w re-park
      yield* chOld.send("stale"); // stale send: must not wake w
      yield* tick(sched);
      yield* chNew.send("fresh");
      const result = yield* w;
      return { result, events };
    });
    const out = await sched.run(op);
    expect(out.result).toBe("new:fresh");
    expect(out.events).toEqual(["interrupted:stop"]);
  });
});

describe("interrupt — termination / no deadlock", () => {
  test("interrupt unblocks a routine parked on a never-resolving journal source", async () => {
    // Without interrupt, `yield* w` would hang forever (w parked on a
    // never-resolving source, main joined). Interrupt must let it
    // terminate. If the impl is wrong, this test hangs → timeout.
    const sched = new Scheduler(testLib);
    const never = deferred<void>();
    const op = gen(function* () {
      const w = spawn(
        gen(function* () {
          try {
            yield* sched.makeJournalFuture(never.promise);
            return "completed";
          } catch (e) {
            return `interrupted:${(e as Error).message}`;
          }
        })
      );
      yield* tick(sched);
      w.interrupt(new Error("stop"));
      return yield* w; // must terminate, not hang
    });
    expect(await sched.run(op)).toBe("interrupted:stop");
  });

  test("interrupt unblocks a routine parked purely on a local source (fan-out can't reach it)", async () => {
    const sched = new Scheduler(testLib);
    const never = deferred<void>();
    const op = gen(function* () {
      const sibling = spawn(
        gen(function* () {
          yield* sched.makeJournalFuture(never.promise);
          return "sib";
        })
      );
      const w = spawn(
        gen(function* () {
          try {
            return yield* sibling; // park on sibling (local, no journal source)
          } catch (e) {
            return `interrupted:${(e as Error).message}`;
          }
        })
      );
      yield* tick(sched);
      w.interrupt(new Error("stop"));
      return yield* w; // must terminate; sibling is abandoned at main exit
    });
    expect(await sched.run(op)).toBe("interrupted:stop");
  });

  test("interrupting all of many spawned routines terminates cleanly (no stuck, no hang)", async () => {
    const sched = new Scheduler(testLib);
    const N = 50;
    const ds = Array.from({ length: N }, () => deferred<void>());
    const op = gen(function* () {
      const tasks = ds.map((d, i) =>
        spawn(
          gen(function* () {
            try {
              yield* sched.makeJournalFuture(d.promise);
              return `done:${i}`;
            } catch {
              return `int:${i}`;
            }
          })
        )
      );
      yield* tick(sched); // let all park
      for (const t of tasks) t.interrupt(new Error("stop"));
      const results = yield* sched.allSettled(tasks);
      return results.map((r) => (r.status === "fulfilled" ? r.value : "rej"));
    });
    const out = await sched.run(op);
    expect(out).toEqual(Array.from({ length: N }, (_, i) => `int:${i}`));
  });

  test("cross-fiber interrupt: a routine interrupts a sibling from its own catch; both terminate", async () => {
    const sched = new Scheduler(testLib);
    const dA = deferred<void>();
    const dB = deferred<void>();
    const holder: { b?: { interrupt(err?: unknown): void } } = {};
    const op = gen(function* () {
      const a = spawn(
        gen(function* () {
          try {
            yield* sched.makeJournalFuture(dA.promise);
            return "A-normal";
          } catch (e) {
            holder.b?.interrupt(new Error("A->B"));
            return `A:${(e as Error).message}`;
          }
        })
      );
      const b = spawn(
        gen(function* () {
          try {
            yield* sched.makeJournalFuture(dB.promise);
            return "B-normal";
          } catch (e) {
            return `B:${(e as Error).message}`;
          }
        })
      );
      holder.b = b;
      yield* tick(sched); // both park
      a.interrupt(new Error("main->A")); // A catches → interrupts B → B catches
      const [ra, rb] = yield* sched.allSettled([a, b]);
      return {
        a: ra.status === "fulfilled" ? ra.value : "rej",
        b: rb.status === "fulfilled" ? rb.value : "rej",
      };
    });
    const out = await sched.run(op);
    expect(out).toEqual({ a: "A:main->A", b: "B:A->B" });
    dA.resolve();
    dB.resolve();
  });

  test("interrupt-recovery re-parking on a dead channel surfaces as 'scheduler stuck', not a silent hang", async () => {
    // If a caught interrupt legitimately re-parks on a source that can
    // never make progress (a channel nobody sends to), and that becomes
    // the whole live wait-graph, the scheduler reports a genuine deadlock
    // loudly rather than hanging. Reachable via interrupt-recovery; pin it.
    const sched = new Scheduler(testLib);
    const dead = sched.makeChannel<string>(); // nobody ever sends
    const never = deferred<void>();
    const op = gen(function* () {
      const w = spawn(
        gen(function* () {
          try {
            yield* sched.makeJournalFuture(never.promise);
            return "completed";
          } catch {
            return yield* dead.receive; // re-park on a channel nobody sends to
          }
        })
      );
      yield* tick(sched);
      w.interrupt(new Error("stop")); // W catches → re-parks on dead.receive
      return yield* w; // main + W now both local-parked, no journal pending
    });
    await expect(sched.run(op)).rejects.toThrow(/scheduler stuck/);
  });

  test("interrupt-then-recover (re-park on a resolvable source) does not trip the stuck detector", async () => {
    const sched = new Scheduler(testLib);
    const d = deferred<void>();
    const recover = deferred<string>();
    const op = gen(function* () {
      const w = spawn(
        gen(function* () {
          try {
            yield* sched.makeJournalFuture(d.promise);
            return "completed";
          } catch {
            return yield* sched.makeJournalFuture(recover.promise);
          }
        })
      );
      yield* tick(sched);
      w.interrupt(new Error("stop"));
      queueMicrotask(() => recover.resolve("recovered"));
      return yield* w;
    });
    expect(await sched.run(op)).toBe("recovered");
    d.resolve();
  });
});

describe("interrupt — Task composition", () => {
  test("a spawned Task composes into all alongside another future", async () => {
    const sched = new Scheduler(testLib);
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    const op = gen(function* () {
      const t1 = spawn(
        gen(function* () {
          return yield* sched.makeJournalFuture(d1.promise);
        })
      );
      const t2 = spawn(
        gen(function* () {
          return yield* sched.makeJournalFuture(d2.promise);
        })
      );
      queueMicrotask(() => {
        d1.resolve("one");
        d2.resolve("two");
      });
      return yield* sched.all([t1, t2]);
    });
    expect(await sched.run(op)).toEqual(["one", "two"]);
  });

  test("interrupting a Task that is an input to all rejects the all", async () => {
    const sched = new Scheduler(testLib);
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    const op = gen(function* () {
      const t1 = spawn(
        gen(function* () {
          // uncaught — the interrupt fails this task
          return yield* sched.makeJournalFuture(d1.promise);
        })
      );
      const t2 = spawn(
        gen(function* () {
          return yield* sched.makeJournalFuture(d2.promise);
        })
      );
      yield* tick(sched);
      t1.interrupt(new Error("boom"));
      queueMicrotask(() => d2.resolve("two"));
      try {
        yield* sched.all([t1, t2]);
        return "no-throw";
      } catch (e) {
        return `all-threw:${(e as Error).message}`;
      }
    });
    expect(await sched.run(op)).toBe("all-threw:boom");
    d1.resolve("never");
  });
});

describe("interrupt — mixed with combinators", () => {
  // (a) Interrupting a routine while it is blocked *inside* a combinator —
  // the throw lands at the combinator yield, the routine's try/catch sees it.

  test("interrupt a routine blocked inside all()", async () => {
    const sched = new Scheduler(testLib);
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    const op = gen(function* () {
      const w = spawn(
        gen(function* () {
          const a = sched.makeJournalFuture(d1.promise);
          const b = sched.makeJournalFuture(d2.promise);
          try {
            const [x, y] = yield* sched.all([a, b]);
            return `all:${x},${y}`;
          } catch (e) {
            return `interrupted:${(e as Error).message}`;
          }
        })
      );
      yield* tick(sched); // let w park inside all()
      w.interrupt(new Error("boom"));
      return yield* w;
    });
    expect(await sched.run(op)).toBe("interrupted:boom");
    d1.resolve("a");
    d2.resolve("b");
  });

  test("interrupt a routine blocked inside race()", async () => {
    const sched = new Scheduler(testLib);
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    const op = gen(function* () {
      const w = spawn(
        gen(function* () {
          try {
            return yield* sched.race([
              sched.makeJournalFuture(d1.promise),
              sched.makeJournalFuture(d2.promise),
            ]);
          } catch (e) {
            return `interrupted:${(e as Error).message}`;
          }
        })
      );
      yield* tick(sched);
      w.interrupt(new Error("boom"));
      return yield* w;
    });
    expect(await sched.run(op)).toBe("interrupted:boom");
    d1.resolve("a");
    d2.resolve("b");
  });

  test("interrupt a routine blocked inside select()", async () => {
    const sched = new Scheduler(testLib);
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    const op = gen(function* () {
      const w = spawn(
        gen(function* () {
          try {
            const r = yield* select({
              x: sched.makeJournalFuture(d1.promise),
              y: sched.makeJournalFuture(d2.promise),
            });
            return `select:${r.tag}`;
          } catch (e) {
            return `interrupted:${(e as Error).message}`;
          }
        })
      );
      yield* tick(sched);
      w.interrupt(new Error("boom"));
      return yield* w;
    });
    expect(await sched.run(op)).toBe("interrupted:boom");
    d1.resolve("a");
    d2.resolve("b");
  });

  // (b) Interrupting one *input* (a spawned Task) of a combinator — the
  // combinator observes that input settling with the interrupt error.

  test("interrupting one input of race(): race settles with the interrupt error", async () => {
    // The interrupted input is the first to settle (with its error); the
    // other input never resolves in this test, so race must pick the
    // interrupted one. race surfaces a rejection if the winner rejected.
    const sched = new Scheduler(testLib);
    const slow = deferred<string>();
    const op = gen(function* () {
      const t1 = spawn(
        gen(function* () {
          return yield* sched.makeJournalFuture(slow.promise); // uncaught
        })
      );
      const t2 = spawn(
        gen(function* () {
          return yield* sched.makeJournalFuture(deferred<string>().promise); // never
        })
      );
      yield* tick(sched);
      t1.interrupt(new Error("boom")); // t1 becomes first-to-settle (rejected)
      try {
        return yield* sched.race([t1, t2]);
      } catch (e) {
        return `race-threw:${(e as Error).message}`;
      }
    });
    expect(await sched.run(op)).toBe("race-threw:boom");
    slow.resolve("never");
  });

  test("interrupting one input of any(): any skips the failed input and resolves via another", async () => {
    const sched = new Scheduler(testLib);
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    const op = gen(function* () {
      const t1 = spawn(
        gen(function* () {
          return yield* sched.makeJournalFuture(d1.promise); // interrupted → rejects
        })
      );
      const t2 = spawn(
        gen(function* () {
          return yield* sched.makeJournalFuture(d2.promise); // succeeds
        })
      );
      yield* tick(sched);
      t1.interrupt(new Error("boom"));
      queueMicrotask(() => d2.resolve("two"));
      return yield* sched.any([t1, t2]); // any ignores the rejection
    });
    expect(await sched.run(op)).toBe("two");
    d1.resolve("never");
  });

  test("interrupting one input of allSettled(): that input is recorded rejected, others fulfilled", async () => {
    const sched = new Scheduler(testLib);
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    const op = gen(function* () {
      const t1 = spawn(
        gen(function* () {
          return yield* sched.makeJournalFuture(d1.promise); // interrupted
        })
      );
      const t2 = spawn(
        gen(function* () {
          return yield* sched.makeJournalFuture(d2.promise);
        })
      );
      yield* tick(sched);
      t1.interrupt(new Error("boom"));
      queueMicrotask(() => d2.resolve("two"));
      const [r1, r2] = yield* sched.allSettled([t1, t2]);
      return {
        r1:
          r1.status === "rejected"
            ? `rej:${(r1.reason as Error).message}`
            : `ok:${r1.value}`,
        r2: r2.status === "fulfilled" ? `ok:${r2.value}` : "rej",
      };
    });
    expect(await sched.run(op)).toEqual({ r1: "rej:boom", r2: "ok:two" });
    d1.resolve("never");
  });

  test("under join, interrupting a routine inside a combinator: the orphaned synth fiber finishes once its inputs settle", async () => {
    // Interrupting a routine blocked inside race() throws into the OUTER
    // routine (it recovers), but race's synthesized inner fiber is not
    // interrupted. Under "join" the scheduler waits for that inner fiber
    // too — it finishes as soon as the combinator's inputs settle (the
    // production case; a never-settling input would hang under join, same
    // as any race loser).
    const sched = new Scheduler(testLib, undefined, { onMainExit: "join" });
    const other = deferred<string>();
    const op = gen(function* () {
      const w = spawn(
        gen(function* () {
          try {
            return yield* sched.race([
              sched.makeJournalFuture(deferred<string>().promise), // loser
              sched.makeJournalFuture(other.promise),
            ]);
          } catch (e) {
            return `recovered:${(e as Error).message}`;
          }
        })
      );
      yield* tick(sched);
      w.interrupt(new Error("stop")); // W recovers; race synth orphaned
      queueMicrotask(() => other.resolve("x")); // lets the synth's race win + finish
      return yield* w;
    });
    expect(await sched.run(op)).toBe("recovered:stop");
  });

  test("interrupting one input of all(): all short-circuits with the interrupt error", async () => {
    const sched = new Scheduler(testLib);
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    const op = gen(function* () {
      const t1 = spawn(
        gen(function* () {
          return yield* sched.makeJournalFuture(d1.promise); // interrupted
        })
      );
      const t2 = spawn(
        gen(function* () {
          return yield* sched.makeJournalFuture(d2.promise);
        })
      );
      yield* tick(sched);
      t1.interrupt(new Error("boom"));
      queueMicrotask(() => d2.resolve("two"));
      try {
        yield* sched.all([t1, t2]);
        return "no-throw";
      } catch (e) {
        return `all-threw:${(e as Error).message}`;
      }
    });
    expect(await sched.run(op)).toBe("all-threw:boom");
    d1.resolve("never");
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
      yield* tick(sched);
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
      yield* tick(sched); // let w park
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
      yield* tick(sched);
      w.interrupt(new Error("stop"));
      return "main-done";
    });
    expect(await sched.run(op)).toBe("main-done");
    expect(finallyRan).toBe(true);
  });
});

describe("interrupt — with invocation cancellation", () => {
  // A targeted user interrupt and the SDK's invocation-cancellation
  // fan-out (the broadcast) deliver through the same wake/resume slot.
  // They must coexist in one run without interference: the interrupt
  // resolves its target, the fan-out still reaches a spawned fiber.

  test("interrupt resolves its target while the cancellation fan-out cancels a spawned fiber", async () => {
    const { lib, cancel } = cancellingLib();
    const sched = new Scheduler(lib);
    const dInt = deferred<void>();
    const dCancel = deferred<void>();
    const op = gen(function* () {
      const wInt = spawn(
        gen(function* () {
          try {
            yield* sched.makeJournalFuture(dInt.promise);
            return "wi-done";
          } catch (e) {
            return `wi:${(e as Error).message}`;
          }
        })
      );
      const wCancel = spawn(
        gen(function* () {
          try {
            yield* sched.makeJournalFuture(dCancel.promise);
            return "wc-done";
          } catch (e) {
            return `wc:${(e as Error).message}`;
          }
        })
      );
      // Interrupt wInt before its first advance: it resolves synchronously
      // in this drain (caught), before any main-loop race — so the
      // cancellation that follows lands only on what is still parked.
      wInt.interrupt(new Error("int"));
      const i = yield* wInt;
      const c = yield* wCancel; // fan-out reaches wCancel on its journal source
      return `${i}|${c}`;
    });
    const result = sched.run(op);
    queueMicrotask(() => cancel(new Error("cancelled")));
    expect(await result).toBe("wi:int|wc:cancelled");
    dInt.resolve();
    dCancel.resolve();
  });

  test("a fiber interrupted then recovered still participates in a later cancellation fan-out", async () => {
    // wInt is interrupted (pre-advance), recovers by re-parking on a
    // journal source, and is then reached by the invocation-cancellation
    // fan-out — confirming the epoch/abort-controller state is sane for a
    // fiber that took an interrupt before the cancel.
    const { lib, cancel } = cancellingLib();
    const sched = new Scheduler(lib);
    const events: string[] = [];
    const op = gen(function* () {
      const w = spawn(
        gen(function* () {
          try {
            yield* sched.makeJournalFuture(deferred<void>().promise);
          } catch (e) {
            events.push(`int:${(e as Error).message}`);
          }
          try {
            yield* sched.makeJournalFuture(deferred<void>().promise);
            return "completed";
          } catch (e) {
            return `cancel:${(e as Error).message}`;
          }
        })
      );
      w.interrupt(new Error("int")); // pre-advance interrupt; w recovers, re-parks
      return yield* w; // main joins w; the cancel race fans out to w's 2nd park
    });
    const result = sched.run(op);
    queueMicrotask(() => cancel(new Error("cancelled")));
    expect(await result).toBe("cancel:cancelled");
    expect(events).toEqual(["int:int"]);
  });
});

describe("interrupt — determinism", () => {
  test("an interrupt+recover+multi-fiber scenario produces identical ordered events every run", async () => {
    // The outcome is fully determined by the interrupts (not by which
    // race the lib happens to win), so it must be byte-identical across
    // repeated runs. Guards against scheduler ordering nondeterminism
    // introduced by interrupt/epoch handling.
    const runScenario = async (): Promise<unknown> => {
      const sched = new Scheduler(testLib);
      const events: string[] = [];
      const op = gen(function* () {
        const mkWorker = (id: number, recover: boolean): Operation<string> =>
          gen(function* () {
            const d = deferred<void>();
            try {
              yield* sched.makeJournalFuture(d.promise);
              return `w${id}:completed`;
            } catch (e) {
              events.push(`w${id}:caught:${(e as Error).message}`);
              if (recover) {
                return `w${id}:recovered`;
              }
              throw e;
            }
          });
        const w0 = spawn(mkWorker(0, true));
        const w1 = spawn(mkWorker(1, false));
        const w2 = spawn(mkWorker(2, true));
        yield* tick(sched);
        w0.interrupt(new Error("i0"));
        w1.interrupt(new Error("i1"));
        w2.interrupt(new Error("i2"));
        const results = yield* sched.allSettled([w0, w1, w2]);
        return {
          events,
          results: results.map((r) =>
            r.status === "fulfilled"
              ? r.value
              : `rej:${(r.reason as Error).message}`
          ),
        };
      });
      return sched.run(op);
    };

    const first = await runScenario();
    expect(first).toEqual({
      events: ["w0:caught:i0", "w1:caught:i1", "w2:caught:i2"],
      results: ["w0:recovered", "rej:i1", "w2:recovered"],
    });
    for (let i = 0; i < 30; i++) {
      expect(await runScenario()).toEqual(first);
    }
  });
});
