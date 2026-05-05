// Adversarial tests: patterns specifically designed to find subtle bugs
// in the scheduler. These come from re-reading the implementation and
// asking "what would break if X happened in order Y?"

import { describe, expect, test } from "vitest";
import {
  gen,
  spawn,
  type Future,
  type Operation,
} from "../src/index.js";
import {
  Scheduler,
} from "../src/internal.js";
import { deferred, resolved, testLib } from "./test-promise.js";

describe("adversarial — spawn-and-immediately-await ordering", () => {
  test("AwaitAny over routines that drain synchronously between park and main-loop", async () => {
    const sched = new Scheduler(testLib);
    // Spawn N children that complete synchronously. Race them. The race
    // body itself yields AwaitAny. By the time AwaitAny dispatches, the
    // children have *not* yet run (they're in ready queue from spawn).
    // The sync short-circuit in AwaitAny only sees them as "done" if
    // they've already been drained. So AwaitAny will park, registering
    // waiters on each child's still-pending routine. Then drainReady
    // picks up the children and runs them; their `finish` fires the
    // waiters; the won-flag picks one.
    const ok = (label: string): Operation<string> =>
      gen(function* (): Generator<unknown, string, unknown> {
        return label;
      });

    const op = gen(function* (): Generator<unknown, string, unknown> {
      const f1 = (yield* spawn(ok("a"))) as Future<string>;
      const f2 = (yield* spawn(ok("b"))) as Future<string>;
      const f3 = (yield* spawn(ok("c"))) as Future<string>;
      // Race immediately, before yielding to give the children a chance.
      // The expectation: AwaitAny parks, children drain in spawn order,
      // first child to finish wakes the parent.
      return (yield* sched.race([f1, f2, f3])) as string;
    });

    const result = await sched.run(op);
    expect(["a", "b", "c"]).toContain(result);
  });

  test("spawn N routines, then race them all in the same routine", async () => {
    const sched = new Scheduler(testLib);
    const tag = (label: string): Operation<string> =>
      gen(function* (): Generator<unknown, string, unknown> {
        // Yield once so this routine is non-trivial.
        yield* sched.makeJournalFuture(resolved<void>(undefined));
        return label;
      });
    const op = gen(function* (): Generator<unknown, string, unknown> {
      const futures: Future<string>[] = [];
      for (let i = 0; i < 10; i++) {
        futures.push((yield* spawn(tag(`r${i}`))) as Future<string>);
      }
      // No prior yield — race them straight away.
      return (yield* sched.race(futures)) as string;
    });
    const result = await sched.run(op);
    expect(result).toMatch(/^r[0-9]+$/);
  });
});

describe("adversarial — race after partial drain", () => {
  test("spawn 3, drive 1 to done, race all 3 — sync short-circuit picks done one", async () => {
    const sched = new Scheduler(testLib);
    const dB = deferred<string>();
    const dC = deferred<string>();
    const finishA: Operation<string> = gen(function* (): Generator<
      unknown,
      string,
      unknown
    > {
      return "a-done";
    });
    const dragB: Operation<string> = gen(function* (): Generator<
      unknown,
      string,
      unknown
    > {
      return (yield* sched.makeJournalFuture(dB.promise)) as string;
    });
    const dragC: Operation<string> = gen(function* (): Generator<
      unknown,
      string,
      unknown
    > {
      return (yield* sched.makeJournalFuture(dC.promise)) as string;
    });

    const op = gen(function* (): Generator<unknown, string, unknown> {
      const fa = (yield* spawn(finishA)) as Future<string>;
      const fb = (yield* spawn(dragB)) as Future<string>;
      const fc = (yield* spawn(dragC)) as Future<string>;
      // Drive a to done.
      yield* fa;
      // Now race all three. fa is done, fb and fc still pending.
      const winner = (yield* sched.race([fa, fb, fc])) as string;
      // Drain losers.
      queueMicrotask(() => {
        dB.resolve("b-late");
        dC.resolve("c-late");
      });
      return winner;
    });

    expect(await sched.run(op)).toBe("a-done");
  });
});

describe("adversarial — chained futures from race results", () => {
  test("the future returned by race itself is yielded by another routine", async () => {
    const sched = new Scheduler(testLib);
    const op = gen(function* (): Generator<unknown, string, unknown> {
      // Build a race-result future without yielding it.
      const raceResult = sched.race([
        sched.makeJournalFuture(resolved("from-race-1")),
        sched.makeJournalFuture(resolved("from-race-2")),
      ]);
      // Spawn a routine that waits on the race result.
      const consumer: Operation<string> = gen(function* (): Generator<
        unknown,
        string,
        unknown
      > {
        return `consumed:${(yield* raceResult) as string}`;
      });
      const fc = (yield* spawn(consumer)) as Future<string>;
      return (yield* fc) as string;
    });
    const result = await sched.run(op);
    expect(result).toMatch(/^consumed:from-race-(1|2)$/);
  });

  test("two routines awaiting the same race-result future see the same value", async () => {
    const sched = new Scheduler(testLib);
    const op = gen(function* (): Generator<unknown, string, unknown> {
      const raceResult = sched.race([
        sched.makeJournalFuture(resolved("shared-a")),
        sched.makeJournalFuture(resolved("shared-b")),
      ]);
      const reader = (label: string): Operation<string> =>
        gen(function* (): Generator<unknown, string, unknown> {
          return `${label}:${(yield* raceResult) as string}`;
        });
      const f1 = (yield* spawn(reader("r1"))) as Future<string>;
      const f2 = (yield* spawn(reader("r2"))) as Future<string>;
      const [a, b] = (yield* sched.all([f1, f2])) as string[];
      // Both readers must see the same race winner.
      const winner1 = a!.split(":")[1];
      const winner2 = b!.split(":")[1];
      expect(winner1).toBe(winner2);
      return `${a},${b}`;
    });
    const result = await sched.run(op);
    expect(result).toMatch(/^r1:shared-(a|b),r2:shared-\1$/);
  });
});

describe("adversarial — error inside a synthesized join body during drain", () => {
  test("all body's yield* throws — the synthesized routine fails", async () => {
    const sched = new Scheduler(testLib);
    // Construct a routine that completes successfully. Then mix it with
    // a journal future that rejects. The all body iterates: yield*
    // the journal future first — it rejects, so the body's catch
    // block (none) doesn't catch it, and the body itself throws. The
    // synthesized routine's finish stores the error; the parent waiting
    // on the all future picks it up.
    const ok: Operation<string> = gen(function* (): Generator<
      unknown,
      string,
      unknown
    > {
      return "ok";
    });
    const op = gen(function* (): Generator<unknown, string, unknown> {
      const fOk = (yield* spawn(ok)) as Future<string>;
      const dBad = deferred<string>();
      const fBad = sched.makeJournalFuture(dBad.promise);
      // Resolve to an error.
      queueMicrotask(() => dBad.reject(new Error("bad-input")));
      try {
        // Mixing a journal source forces the routine path.
        yield* sched.all([fOk, fBad]);
        return "no-throw";
      } catch (e) {
        return `err:${(e as Error).message}`;
      }
    });
    expect(await sched.run(op)).toBe("err:bad-input");
  });
});

describe("adversarial — many simultaneous AwaitAnys from different routines", () => {
  test("N routines each running AwaitAny on a shared deferred wake on resolution", async () => {
    const sched = new Scheduler(testLib);
    const dShared = deferred<string>();
    const observer = (id: number): Operation<string> =>
      gen(function* (): Generator<unknown, string, unknown> {
        const fShared = sched.makeJournalFuture(dShared.promise);
        const fOther = sched.makeJournalFuture(resolved<string>(`other${id}`));
        // Race the shared (deferred) against a sync-resolved local.
        // The local always wins via short-circuit, but this exercises
        // having many routines parked with their own AwaitAny structures.
        return (yield* sched.race([fShared, fOther])) as string;
      });

    const op = gen(function* (): Generator<unknown, string[], unknown> {
      const fs: Future<string>[] = [];
      for (let i = 0; i < 10; i++) {
        fs.push((yield* spawn(observer(i))) as Future<string>);
      }
      // Eventually resolve shared (no observer should care).
      queueMicrotask(() => dShared.resolve("shared-payload"));
      return (yield* sched.all(fs)) as string[];
    });

    const result = await sched.run(op);
    // All 10 observers should win their `other` branch (sync short-circuit
    // on a sync-resolved journal future races against a deferred journal
    // future; whichever the lib picks first wins). Allowing for either.
    expect(result).toHaveLength(10);
    for (let i = 0; i < 10; i++) {
      expect([`other${i}`, "shared-payload"]).toContain(result[i]);
    }
  });
});

describe("adversarial — yield* after sync-shortcircuit in the same routine", () => {
  test("a routine doing AwaitAny then immediately yielding more journal futures", async () => {
    const sched = new Scheduler(testLib);
    const op = gen(function* (): Generator<unknown, string, unknown> {
      // First: AwaitAny short-circuits because routine-source is done.
      const child: Operation<string> = gen(function* (): Generator<
        unknown,
        string,
        unknown
      > {
        return "child-done";
      });
      const fc = (yield* spawn(child)) as Future<string>;
      // Drive child.
      yield* fc;
      // Now sync short-circuit on AwaitAny.
      const r1 = (yield* sched.race([fc])) as string;
      // Then yield some normal stuff.
      const v = (yield* sched.makeJournalFuture(resolved("normal"))) as string;
      return `${r1}+${v}`;
    });
    expect(await sched.run(op)).toBe("child-done+normal");
  });
});
