import { describe, expect, test } from "vitest";
import {
  gen,
  spawn,
  type Future,
} from "../src/index.js";
import {
  Scheduler,
} from "../src/internal.js";
import { deferred, resolved, rejected, testLib } from "./test-promise.js";

describe("all — journal sources (fast path)", () => {
  test("waits for every input, returns array in order", async () => {
    const sched = new Scheduler(testLib);
    const f1 = sched.makeJournalFuture(resolved("a"));
    const f2 = sched.makeJournalFuture(resolved("b"));
    const f3 = sched.makeJournalFuture(resolved("c"));
    const op = gen(function* (): Generator<unknown, string[], unknown> {
      return (yield* sched.all([f1, f2, f3])) as string[];
    });
    expect(await sched.run(op)).toEqual(["a", "b", "c"]);
  });

  test("preserves index order even with out-of-order resolution", async () => {
    const sched = new Scheduler(testLib);
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    const d3 = deferred<string>();
    const f1 = sched.makeJournalFuture(d1.promise);
    const f2 = sched.makeJournalFuture(d2.promise);
    const f3 = sched.makeJournalFuture(d3.promise);
    const op = gen(function* (): Generator<unknown, string[], unknown> {
      return (yield* sched.all([f1, f2, f3])) as string[];
    });
    const result = sched.run(op);
    queueMicrotask(() => {
      d3.resolve("c");
      d1.resolve("a");
      d2.resolve("b");
    });
    expect(await result).toEqual(["a", "b", "c"]);
  });

  test("propagates the first rejection", async () => {
    const sched = new Scheduler(testLib);
    const f1 = sched.makeJournalFuture(resolved("a"));
    const f2 = sched.makeJournalFuture(rejected(new Error("middle")));
    const f3 = sched.makeJournalFuture(resolved("c"));
    const op = gen(function* (): Generator<unknown, string, unknown> {
      try {
        yield* sched.all([f1, f2, f3]);
        return "no-throw";
      } catch (e) {
        return (e as Error).message;
      }
    });
    expect(await sched.run(op)).toBe("middle");
  });

  test("empty array resolves to empty array", async () => {
    const sched = new Scheduler(testLib);
    const op = gen(function* (): Generator<unknown, string[], unknown> {
      return (yield* sched.all([])) as string[];
    });
    expect(await sched.run(op)).toEqual([]);
  });

  test("single input array resolves to single-element array", async () => {
    const sched = new Scheduler(testLib);
    const f = sched.makeJournalFuture(resolved("only"));
    const op = gen(function* (): Generator<unknown, string[], unknown> {
      return (yield* sched.all([f])) as string[];
    });
    expect(await sched.run(op)).toEqual(["only"]);
  });
});

describe("all — routine sources (synthesized join)", () => {
  test("waits for every spawned routine, returns array in order", async () => {
    const sched = new Scheduler(testLib);
    const work = (label: string) =>
      gen(function* (): Generator<unknown, string, unknown> {
        return label;
      });

    const op = gen(function* (): Generator<unknown, string[], unknown> {
      const f1 = (yield* spawn(work("a"))) as Future<string>;
      const f2 = (yield* spawn(work("b"))) as Future<string>;
      const f3 = (yield* spawn(work("c"))) as Future<string>;
      return (yield* sched.all([f1, f2, f3])) as string[];
    });
    expect(await sched.run(op)).toEqual(["a", "b", "c"]);
  });

  test("propagates a routine error", async () => {
    const sched = new Scheduler(testLib);
    const fail = gen(function* (): Generator<unknown, never, unknown> {
      throw new Error("routine-fail");
    });
    const ok = gen(function* (): Generator<unknown, string, unknown> {
      return "ok";
    });

    const op = gen(function* (): Generator<unknown, string, unknown> {
      const f1 = (yield* spawn(ok)) as Future<string>;
      const f2 = (yield* spawn(fail)) as Future<never>;
      try {
        yield* sched.all([f1, f2]);
        return "no-throw";
      } catch (e) {
        return (e as Error).message;
      }
    });
    expect(await sched.run(op)).toBe("routine-fail");
  });
});

describe("all — mixed sources", () => {
  test("mixes journal and routine futures, preserves order", async () => {
    const sched = new Scheduler(testLib);
    const j = sched.makeJournalFuture(resolved("j"));
    const r = gen(function* (): Generator<unknown, string, unknown> {
      return "r";
    });

    const op = gen(function* (): Generator<unknown, string[], unknown> {
      const rf = (yield* spawn(r)) as Future<string>;
      return (yield* sched.all([j, rf])) as string[];
    });
    expect(await sched.run(op)).toEqual(["j", "r"]);
  });

  test("mixed: routine settles first, then journal", async () => {
    const sched = new Scheduler(testLib);
    const dj = deferred<string>();
    const j = sched.makeJournalFuture(dj.promise);
    const r = gen(function* (): Generator<unknown, string, unknown> {
      return "r-fast";
    });
    const op = gen(function* (): Generator<unknown, string[], unknown> {
      const rf = (yield* spawn(r)) as Future<string>;
      queueMicrotask(() => dj.resolve("j-slow"));
      return (yield* sched.all([j, rf])) as string[];
    });
    expect(await sched.run(op)).toEqual(["j-slow", "r-fast"]);
  });
});
