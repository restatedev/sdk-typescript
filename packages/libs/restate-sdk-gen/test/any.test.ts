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

describe("any — journal sources (fast path)", () => {
  test("returns the first fulfilled value", async () => {
    const sched = new Scheduler(testLib);
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    const f1 = sched.makeJournalFuture(d1.promise);
    const f2 = sched.makeJournalFuture(d2.promise);
    const op = gen(function* (): Generator<unknown, string, unknown> {
      return (yield* sched.any([f1, f2])) as string;
    });
    const result = sched.run(op);
    queueMicrotask(() => d2.resolve("two"));
    expect(await result).toBe("two");
    d1.resolve("one");
  });

  test("skips early rejections, settles with first fulfillment", async () => {
    const sched = new Scheduler(testLib);
    const f1 = sched.makeJournalFuture(rejected(new Error("nope")));
    const f2 = sched.makeJournalFuture(resolved("good"));
    const op = gen(function* (): Generator<unknown, string, unknown> {
      return (yield* sched.any([f1, f2])) as string;
    });
    expect(await sched.run(op)).toBe("good");
  });

  test("rejects with AggregateError when every input rejects", async () => {
    const sched = new Scheduler(testLib);
    const f1 = sched.makeJournalFuture(rejected(new Error("a")));
    const f2 = sched.makeJournalFuture(rejected(new Error("b")));
    const op = gen(function* (): Generator<unknown, string, unknown> {
      try {
        return (yield* sched.any([f1, f2])) as string;
      } catch (e) {
        if (e instanceof AggregateError) {
          const msgs = (e.errors as Error[]).map((x) => x.message).join(",");
          return `agg:${msgs}`;
        }
        return `unexpected:${(e as Error).message}`;
      }
    });
    expect(await sched.run(op)).toBe("agg:a,b");
  });

  test("empty input rejects with AggregateError", async () => {
    const sched = new Scheduler(testLib);
    const op = gen(function* (): Generator<unknown, string, unknown> {
      try {
        return (yield* sched.any([])) as string;
      } catch (e) {
        return e instanceof AggregateError ? "agg-empty" : "wrong";
      }
    });
    expect(await sched.run(op)).toBe("agg-empty");
  });
});

describe("any — routine sources (synthesized loop)", () => {
  test("first fulfilled routine wins, others discarded", async () => {
    const sched = new Scheduler(testLib);
    const fast = gen(function* (): Generator<unknown, string, unknown> {
      return "fast-result";
    });
    const slow = gen(function* (): Generator<unknown, string, unknown> {
      return "slow-result";
    });

    const op = gen(function* (): Generator<unknown, string, unknown> {
      const f1 = (yield* spawn(fast)) as Future<string>;
      const f2 = (yield* spawn(slow)) as Future<string>;
      return (yield* sched.any([f1, f2])) as string;
    });
    expect(await sched.run(op)).toBe("fast-result");
  });

  test("collects rejections in input order, throws AggregateError", async () => {
    const sched = new Scheduler(testLib);
    const fail = (msg: string) =>
      gen(function* (): Generator<unknown, never, unknown> {
        throw new Error(msg);
      });

    const op = gen(function* (): Generator<unknown, string, unknown> {
      const f1 = (yield* spawn(fail("a"))) as Future<string>;
      const f2 = (yield* spawn(fail("b"))) as Future<string>;
      const f3 = (yield* spawn(fail("c"))) as Future<string>;
      try {
        return (yield* sched.any([f1, f2, f3])) as string;
      } catch (e) {
        if (e instanceof AggregateError) {
          return (e.errors as Error[]).map((x) => x.message).join(",");
        }
        return "wrong";
      }
    });
    expect(await sched.run(op)).toBe("a,b,c");
  });
});

describe("any — mixed sources", () => {
  test("routine fulfills first, journal not needed", async () => {
    const sched = new Scheduler(testLib);
    const dj = deferred<string>();
    const j = sched.makeJournalFuture(dj.promise);
    const r = gen(function* (): Generator<unknown, string, unknown> {
      return "routine";
    });

    const op = gen(function* (): Generator<unknown, string, unknown> {
      const rf = (yield* spawn(r)) as Future<string>;
      return (yield* sched.any([j, rf])) as string;
    });
    const result = sched.run(op);
    expect(await result).toBe("routine");
    dj.resolve("journal-late"); // unblock teardown
  });

  test("first journal rejects, routine wins", async () => {
    const sched = new Scheduler(testLib);
    const j = sched.makeJournalFuture(rejected(new Error("j-fail")));
    const r = gen(function* (): Generator<unknown, string, unknown> {
      return "r-good";
    });

    const op = gen(function* (): Generator<unknown, string, unknown> {
      const rf = (yield* spawn(r)) as Future<string>;
      return (yield* sched.any([j, rf])) as string;
    });
    expect(await sched.run(op)).toBe("r-good");
  });
});
