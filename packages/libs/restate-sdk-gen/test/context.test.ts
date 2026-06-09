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

import { describe, expect, test } from "vitest";
import {
  gen,
  spawn,
  all,
  contextLocal,
  type ContextLocal,
} from "../src/index.js";
import { Scheduler } from "../src/internal.js";
import { deferred, testLib } from "./test-promise.js";

describe("contextLocal — basics", () => {
  test("set then get returns the value", async () => {
    const sched = new Scheduler(testLib);
    const slot = contextLocal<string>("default");
    const op = gen(function* () {
      slot.set("hello");
      return slot.get();
    });
    expect(await sched.run(op)).toBe("hello");
  });

  test("get before set returns the default", async () => {
    const sched = new Scheduler(testLib);
    const slot = contextLocal<string>("default");
    const op = gen(function* () {
      return slot.get();
    });
    expect(await sched.run(op)).toBe("default");
  });

  test("get before set with no default returns undefined", async () => {
    const sched = new Scheduler(testLib);
    const slot = contextLocal<string>();
    const op = gen(function* () {
      return slot.get();
    });
    expect(await sched.run(op)).toBeUndefined();
  });

  test("set overrides default", async () => {
    const sched = new Scheduler(testLib);
    const slot = contextLocal<number>(0);
    const op = gen(function* () {
      slot.set(42);
      return slot.get();
    });
    expect(await sched.run(op)).toBe(42);
  });

  test("explicit set(undefined) reads back undefined, not the default", async () => {
    const sched = new Scheduler(testLib);
    const slot = contextLocal<string | undefined>("default");
    const op = gen(function* () {
      slot.set(undefined);
      return slot.get();
    });
    expect(await sched.run(op)).toBeUndefined();
  });

  test("falsy values round-trip past a non-falsy default (has-check, not ??)", async () => {
    // The store uses Map.has, not `?? default`, so an explicitly-set
    // falsy value is returned rather than falling through to the default.
    const num = contextLocal<number>(99);
    const str = contextLocal<string>("x");
    const bool = contextLocal<boolean>(true);
    const nullable = contextLocal<string | null>("x");
    const op = gen(function* () {
      num.set(0);
      str.set("");
      bool.set(false);
      nullable.set(null);
      return [num.get(), str.get(), bool.get(), nullable.get()];
    });
    expect(await new Scheduler(testLib).run(op)).toEqual([0, "", false, null]);
  });

  test("a later set overwrites an earlier one", async () => {
    const sched = new Scheduler(testLib);
    const slot = contextLocal<string>();
    const op = gen(function* () {
      slot.set("first");
      slot.set("second");
      return slot.get();
    });
    expect(await sched.run(op)).toBe("second");
  });

  test("stores object values by reference", async () => {
    const sched = new Scheduler(testLib);
    const obj = { n: 1 };
    const slot = contextLocal<{ n: number }>({ n: 0 });
    const op = gen(function* () {
      slot.set(obj);
      const got = slot.get();
      got.n = 2;
      return slot.get().n;
    });
    expect(await sched.run(op)).toBe(2);
    expect(obj.n).toBe(2); // same reference, not a copy
  });

  test("distinct handles do not collide, even with the same value type", async () => {
    const sched = new Scheduler(testLib);
    const a = contextLocal<string>();
    const b = contextLocal<string>();
    const c = contextLocal<string>("c-default");
    const op = gen(function* () {
      a.set("A");
      b.set("B");
      // c left unset
      return [a.get(), b.get(), c.get()];
    });
    expect(await sched.run(op)).toEqual(["A", "B", "c-default"]);
  });
});

describe("contextLocal — sharing across fibers (global per invocation)", () => {
  test("main sets, a spawned child reads the same value", async () => {
    const sched = new Scheduler(testLib);
    const slot = contextLocal<string>("default");
    const op = gen(function* () {
      slot.set("from-main");
      const child = spawn(
        gen(function* () {
          return slot.get();
        })
      );
      return yield* child;
    });
    expect(await sched.run(op)).toBe("from-main");
  });

  test("a child's write is visible to main after the child runs", async () => {
    const sched = new Scheduler(testLib);
    const slot = contextLocal<string>("default");
    const op = gen(function* () {
      const child = spawn(
        gen(function* () {
          slot.set("from-child");
          return 1;
        })
      );
      yield* child; // join — ensures the child advanced
      return slot.get();
    });
    expect(await sched.run(op)).toBe("from-child");
  });

  test("one sibling's write is visible to another (shared bag)", async () => {
    const sched = new Scheduler(testLib);
    const slot = contextLocal<string>();
    const op = gen(function* () {
      const a = spawn(
        gen(function* () {
          slot.set("a-wrote-this");
          return 1;
        })
      );
      yield* a; // ensure A ran before B reads
      const b = spawn(
        gen(function* () {
          return slot.get();
        })
      );
      return yield* b;
    });
    expect(await sched.run(op)).toBe("a-wrote-this");
  });

  test("a later cross-fiber write overwrites an earlier one (last write wins)", async () => {
    // The documented sharp edge: writers to the same slot clobber each
    // other; a reader sees whichever advanced last. Sequencing the two
    // writers with joins pins which write lands last, deterministically.
    const sched = new Scheduler(testLib);
    const slot = contextLocal<string>("init");
    const op = gen(function* () {
      const a = spawn(
        gen(function* () {
          slot.set("from-A");
          return 1;
        })
      );
      yield* a; // A advanced and wrote
      const b = spawn(
        gen(function* () {
          slot.set("from-B");
          return 1;
        })
      );
      yield* b; // B advanced last
      return slot.get();
    });
    expect(await sched.run(op)).toBe("from-B");
  });

  test("value set in main is shared by concurrent spawned routines combined via all", async () => {
    const sched = new Scheduler(testLib);
    const slot = contextLocal<string>("default");
    const op = gen(function* () {
      slot.set("shared");
      const f1 = spawn(
        gen(function* () {
          return slot.get();
        })
      );
      const f2 = spawn(
        gen(function* () {
          return slot.get();
        })
      );
      const [a, b] = yield* all([f1, f2]);
      return `${a}+${b}`;
    });
    expect(await sched.run(op)).toBe("shared+shared");
  });
});

describe("contextLocal — invocation isolation", () => {
  test("two schedulers have independent stores", async () => {
    const slot = contextLocal<string>("default");
    const sched1 = new Scheduler(testLib);
    const sched2 = new Scheduler(testLib);

    const r1 = await sched1.run(
      gen(function* () {
        slot.set("one");
        return slot.get();
      })
    );
    const r2 = await sched2.run(
      gen(function* () {
        return slot.get(); // never set in this invocation
      })
    );
    expect(r1).toBe("one");
    expect(r2).toBe("default"); // sched1's write did not leak across
  });

  test("two interleaved schedulers each read only their own slot value", async () => {
    // Not sequential: both invocations advance to a suspension point
    // before either is awaited, then resume out of order. Validates that
    // the module-level CURRENT slot (set/cleared around each advance) is
    // re-installed per fiber, so neither invocation sees the other's bag.
    const slot = contextLocal<string>("default");
    const s1 = new Scheduler(testLib);
    const s2 = new Scheduler(testLib);
    const d1 = deferred<void>();
    const d2 = deferred<void>();
    const f1 = s1.makeJournalFuture(d1.promise);
    const f2 = s2.makeJournalFuture(d2.promise);
    const mk = (name: string, f: typeof f1) =>
      gen(function* () {
        slot.set(name);
        yield* f; // suspend
        return slot.get();
      });
    const p1 = s1.run(mk("one", f1));
    const p2 = s2.run(mk("two", f2));
    d2.resolve(); // resume in reverse start order
    d1.resolve();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe("one");
    expect(r2).toBe("two");
  });

  test("the store is fresh per execute — a prior run's value does not survive", async () => {
    const slot = contextLocal<number>(0);
    const op = gen(function* () {
      const before = slot.get();
      slot.set(before + 1);
      return slot.get();
    });
    // A fresh scheduler each run = a fresh bag, so each run starts from 0.
    expect(await new Scheduler(testLib).run(op)).toBe(1);
    expect(await new Scheduler(testLib).run(op)).toBe(1);
  });
});

describe("contextLocal — usage errors", () => {
  test("get outside an active fiber throws", () => {
    const slot = contextLocal<string>();
    expect(() => slot.get()).toThrow(/outside an active fiber/);
  });

  test("set outside an active fiber throws", () => {
    const slot = contextLocal<string>();
    expect(() => slot.set("x")).toThrow(/outside an active fiber/);
  });

  test("get/set off the advance span (e.g. inside a run closure) throws while a scheduler is live", async () => {
    // The boundary the synchronous-slot design rests on: CURRENT is only
    // installed during a fiber's advance. A callback that runs after the
    // fiber parks (here, a microtask draining at the scheduler await —
    // the same point an `ops.run` closure resolves) sees CURRENT === null
    // and must throw, not read/write a bag. A future change to slot
    // lifetime (e.g. AsyncLocalStorage) would break this test rather than
    // silently leak the bag into off-advance code.
    const sched = new Scheduler(testLib);
    const slot = contextLocal<string>("default");
    const d = deferred<void>();
    const f = sched.makeJournalFuture(d.promise);
    let captured: unknown = null;
    const op = gen(function* () {
      slot.set("from-fiber");
      queueMicrotask(() => {
        try {
          slot.set("from-callback");
        } catch (e) {
          captured = e;
        }
        d.resolve(); // let the fiber resume after the callback ran
      });
      yield* f; // park; the microtask runs while CURRENT is cleared
      return slot.get();
    });
    const result = await sched.run(op);
    expect((captured as Error | null)?.message).toMatch(
      /outside an active fiber/
    );
    expect(result).toBe("from-fiber"); // the failed callback write left the bag untouched
  });
});

describe("contextLocal — type invariance", () => {
  test("ContextLocal<T> is invariant in T (a subtype slot is not a supertype slot)", () => {
    type Animal = { name: string };
    type Dog = { name: string; bark(): void };
    const dogSlot = contextLocal<Dog>();
    // If `set` were checked bivariantly (method syntax), this widening
    // would be wrongly accepted, letting set() store a bare Animal while
    // get() still claims Dog. Arrow-property fields make it a type error.
    // @ts-expect-error ContextLocal is invariant in T — no unsound widening.
    const animalSlot: ContextLocal<Animal> = dogSlot;
    void animalSlot;
  });
});

describe("contextLocal — determinism", () => {
  test("a value derived from a journaled result flows through deterministically", async () => {
    const sched = new Scheduler(testLib);
    const slot = contextLocal<string>();
    const d = deferred<string>();
    const f = sched.makeJournalFuture(d.promise);
    const op = gen(function* () {
      const v = yield* f; // journal source (replays identically)
      slot.set(v);
      return slot.get();
    });
    d.resolve("journaled");
    expect(await sched.run(op)).toBe("journaled");
  });

  test("a value set before a suspension point is re-derived the same way", async () => {
    // Models replay: the body re-runs from the top and re-sets the slot
    // from the same (journaled) inputs, so the read after the await is
    // stable. Here the deferred stands in for the journal entry.
    const sched = new Scheduler(testLib);
    const slot = contextLocal<string>("unset");
    const gate = deferred<void>();
    const f = sched.makeJournalFuture(gate.promise);
    const op = gen(function* () {
      slot.set("set-before-await");
      yield* f; // suspension point
      return slot.get();
    });
    gate.resolve();
    expect(await sched.run(op)).toBe("set-before-await");
  });
});
