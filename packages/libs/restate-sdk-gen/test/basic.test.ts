import { describe, expect, test } from "vitest";
import {
  gen,
  type Operation,
} from "../src/index.js";
import {
  Scheduler,
} from "../src/internal.js";
import { testLib } from "./test-promise.js";

describe("gen — basics", () => {
  test("body runs to completion and returns its value", async () => {
    const sched = new Scheduler(testLib);
    const op = gen(function* (): Generator<unknown, string, unknown> {
      return "hello";
    });
    expect(await sched.run(op)).toBe("hello");
  });

  test("body that does no yields returns its value directly", async () => {
    const sched = new Scheduler(testLib);
    const op = gen(function* (): Generator<unknown, number, unknown> {
      return 42;
    });
    expect(await sched.run(op)).toBe(42);
  });

  test("empty body returns undefined", async () => {
    const sched = new Scheduler(testLib);
    const op = gen(function* (): Generator<unknown, void, unknown> {});
    expect(await sched.run(op)).toBeUndefined();
  });

  test("error thrown in body propagates", async () => {
    const sched = new Scheduler(testLib);
    const op = gen(function* (): Generator<unknown, never, unknown> {
      throw new Error("nope");
    });
    await expect(sched.run(op)).rejects.toThrow("nope");
  });

  test("body that returns null/0/false propagates the value", async () => {
    const sched = new Scheduler(testLib);
    expect(
      await sched.run(
        gen(function* (): Generator<unknown, null, unknown> {
          return null;
        })
      )
    ).toBeNull();
    expect(
      await sched.run(
        gen(function* (): Generator<unknown, number, unknown> {
          return 0;
        })
      )
    ).toBe(0);
    expect(
      await sched.run(
        gen(function* (): Generator<unknown, boolean, unknown> {
          return false;
        })
      )
    ).toBe(false);
  });
});

describe("gen — reusability", () => {
  test("same op can be run twice; body re-executes each time", async () => {
    const sched1 = new Scheduler(testLib);
    const sched2 = new Scheduler(testLib);
    let calls = 0;
    const op = gen(function* (): Generator<unknown, number, unknown> {
      calls++;
      return calls;
    });
    expect(await sched1.run(op)).toBe(1);
    expect(await sched2.run(op)).toBe(2);
    expect(calls).toBe(2);
  });

  test("running the same op concurrently gives independent executions", async () => {
    const sched1 = new Scheduler(testLib);
    const sched2 = new Scheduler(testLib);
    let calls = 0;
    const op = gen(function* (): Generator<unknown, number, unknown> {
      const myCall = ++calls;
      return myCall;
    });
    // Run both concurrently — they should each get their own call number.
    const [a, b] = await Promise.all([sched1.run(op), sched2.run(op)]);
    expect(new Set([a, b])).toEqual(new Set([1, 2]));
  });
});

describe("gen — nesting via yield*", () => {
  test("yield* on a nested gen op flows the return value through", async () => {
    const sched = new Scheduler(testLib);
    const inner: Operation<number> = gen(function* (): Generator<
      unknown,
      number,
      unknown
    > {
      return 7;
    });
    const outer = gen(function* (): Generator<unknown, number, unknown> {
      const v = (yield* inner) as number;
      return v * 2;
    });
    expect(await sched.run(outer)).toBe(14);
  });

  test("yield* on a nested gen propagates errors", async () => {
    const sched = new Scheduler(testLib);
    const inner = gen(function* (): Generator<unknown, never, unknown> {
      throw new Error("inner-fail");
    });
    const outer = gen(function* (): Generator<unknown, string, unknown> {
      try {
        yield* inner;
        return "no-throw";
      } catch (e) {
        return (e as Error).message;
      }
    });
    expect(await sched.run(outer)).toBe("inner-fail");
  });

  test("deeply nested gen (10 levels) propagates a value through", async () => {
    const sched = new Scheduler(testLib);
    const buildLevel = (n: number): Operation<number> =>
      gen(function* (): Generator<unknown, number, unknown> {
        if (n === 0) return 0;
        const inner = (yield* buildLevel(n - 1)) as number;
        return inner + 1;
      });
    expect(await sched.run(buildLevel(10))).toBe(10);
  });

  test("two sequential yield* of different ops chain values", async () => {
    const sched = new Scheduler(testLib);
    const a = gen(function* (): Generator<unknown, string, unknown> {
      return "a";
    });
    const b = gen(function* (): Generator<unknown, string, unknown> {
      return "b";
    });
    const op = gen(function* (): Generator<unknown, string, unknown> {
      const x = (yield* a) as string;
      const y = (yield* b) as string;
      return x + y;
    });
    expect(await sched.run(op)).toBe("ab");
  });
});
