import { describe, expect, test } from "vitest";
import {
  gen,
  spawn,
  type Future,
  type FutureSettledResult,
  type FutureRejectedResult,
} from "../src/index.js";
import {
  Scheduler,
} from "../src/internal.js";
import { deferred, resolved, rejected, testLib } from "./test-promise.js";

describe("allSettled — journal sources (fast path)", () => {
  test("returns fulfilled and rejected results in input order", async () => {
    const sched = new Scheduler(testLib);
    const f1 = sched.makeJournalFuture(resolved("a"));
    const f2 = sched.makeJournalFuture(rejected(new Error("middle")));
    const f3 = sched.makeJournalFuture(resolved("c"));
    const op = gen(function* (): Generator<
      unknown,
      FutureSettledResult<string>[],
      unknown
    > {
      return (yield* sched.allSettled([
        f1,
        f2,
        f3,
      ])) as FutureSettledResult<string>[];
    });
    const out = await sched.run(op);
    expect(out[0]).toEqual({ status: "fulfilled", value: "a" });
    expect(out[1]?.status).toBe("rejected");
    expect((out[1] as FutureRejectedResult).reason).toBeInstanceOf(Error);
    expect(((out[1] as FutureRejectedResult).reason as Error).message).toBe(
      "middle"
    );
    expect(out[2]).toEqual({ status: "fulfilled", value: "c" });
  });

  test("preserves index order despite out-of-order resolution", async () => {
    const sched = new Scheduler(testLib);
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    const d3 = deferred<string>();
    const f1 = sched.makeJournalFuture(d1.promise);
    const f2 = sched.makeJournalFuture(d2.promise);
    const f3 = sched.makeJournalFuture(d3.promise);
    const op = gen(function* (): Generator<
      unknown,
      FutureSettledResult<string>[],
      unknown
    > {
      return (yield* sched.allSettled([
        f1,
        f2,
        f3,
      ])) as FutureSettledResult<string>[];
    });
    const result = sched.run(op);
    queueMicrotask(() => {
      d3.resolve("c");
      d1.reject(new Error("a-fail"));
      d2.resolve("b");
    });
    const out = await result;
    expect(out[0]?.status).toBe("rejected");
    expect(out[1]).toEqual({ status: "fulfilled", value: "b" });
    expect(out[2]).toEqual({ status: "fulfilled", value: "c" });
  });

  test("empty array resolves to empty array", async () => {
    const sched = new Scheduler(testLib);
    const op = gen(function* (): Generator<
      unknown,
      FutureSettledResult<string>[],
      unknown
    > {
      return (yield* sched.allSettled([])) as FutureSettledResult<string>[];
    });
    expect(await sched.run(op)).toEqual([]);
  });
});

describe("allSettled — routine sources (synthesized join)", () => {
  test("captures every routine outcome in order", async () => {
    const sched = new Scheduler(testLib);
    const ok = (label: string) =>
      gen(function* (): Generator<unknown, string, unknown> {
        return label;
      });
    const fail = (msg: string) =>
      gen(function* (): Generator<unknown, never, unknown> {
        throw new Error(msg);
      });

    const op = gen(function* (): Generator<
      unknown,
      FutureSettledResult<string>[],
      unknown
    > {
      const f1 = (yield* spawn(ok("a"))) as Future<string>;
      const f2 = (yield* spawn(fail("b-fail"))) as Future<string>;
      const f3 = (yield* spawn(ok("c"))) as Future<string>;
      return (yield* sched.allSettled([
        f1,
        f2,
        f3,
      ])) as FutureSettledResult<string>[];
    });
    const out = await sched.run(op);
    expect(out[0]).toEqual({ status: "fulfilled", value: "a" });
    expect(out[1]?.status).toBe("rejected");
    expect(((out[1] as FutureRejectedResult).reason as Error).message).toBe(
      "b-fail"
    );
    expect(out[2]).toEqual({ status: "fulfilled", value: "c" });
  });
});

describe("allSettled — mixed sources", () => {
  test("mixes journal and routine futures, preserves order", async () => {
    const sched = new Scheduler(testLib);
    const j = sched.makeJournalFuture(resolved("j"));
    const r = gen(function* (): Generator<unknown, string, unknown> {
      return "r";
    });

    const op = gen(function* (): Generator<
      unknown,
      FutureSettledResult<string>[],
      unknown
    > {
      const rf = (yield* spawn(r)) as Future<string>;
      return (yield* sched.allSettled([
        j,
        rf,
      ])) as FutureSettledResult<string>[];
    });
    const out = await sched.run(op);
    expect(out).toEqual([
      { status: "fulfilled", value: "j" },
      { status: "fulfilled", value: "r" },
    ]);
  });
});
