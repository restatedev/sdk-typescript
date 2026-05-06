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

// Channel<T> tests.
//
// Single-shot in-memory channel. `yield* ch.send(v)` is fire-and-forget
// and idempotent (first call settles, subsequent calls dropped).
// `receive` is a stable Future<T> — same handle every time, settles
// once, stays settled.
//
// Determinism contract: `send()` returns `Operation<void>` so the only
// way to fire it is via `yield*` from inside a fiber. External
// producers (setTimeout, queueMicrotask outside the workflow body)
// cannot use `yield*` and so cannot fire a channel — that's the
// type-level enforcement of intra-workflow-only semantics. For tests
// that need "send after the receiver parks," spawn a coordinator
// fiber that does the send.

import { describe, expect, test } from "vitest";
import {
  gen,
  spawn,
  select,
  type Operation,
  type Future,
  type Channel,
} from "../src/index.js";
import { Scheduler } from "../src/internal.js";
import { testLib, deferred } from "./test-promise.js";

// Helper: an Operation that yields the send (firing it). Spawn this
// to send "after the receiver has parked" — the spawned fiber sits in
// the ready queue while the parent (or sibling) fiber advances and
// parks on receive, then drainReady picks it up.
const sender = <T>(ch: Channel<T>, value: T): Operation<void> =>
  gen(function* () {
    yield* ch.send(value);
  });

describe("channel — basic send/receive", () => {
  test("send-then-receive: receiver gets the sent value", async () => {
    const sched = new Scheduler(testLib);
    const ch = sched.makeChannel<string>();
    const op = gen(function* (): Generator<unknown, string, unknown> {
      yield* ch.send("hello");
      return (yield* ch.receive) as string;
    });
    expect(await sched.run(op)).toBe("hello");
  });

  test("receive-then-send: receiver wakes when send arrives", async () => {
    const sched = new Scheduler(testLib);
    const ch = sched.makeChannel<string>();
    const op = gen(function* (): Generator<unknown, string, unknown> {
      // The coordinator fiber sits in the ready queue while we yield on
      // receive and park. Then drainReady advances the coordinator,
      // which sends and wakes us.
      yield* spawn(sender(ch, "delayed"));
      return (yield* ch.receive) as string;
    });
    expect(await sched.run(op)).toBe("delayed");
  });

  test("receive is the same Future on every access", () => {
    const sched = new Scheduler(testLib);
    const ch = sched.makeChannel<string>();
    expect(ch.receive).toBe(ch.receive);
  });
});

describe("channel — idempotence of send", () => {
  test("subsequent send calls are dropped; first value wins", async () => {
    const sched = new Scheduler(testLib);
    const ch = sched.makeChannel<string>();
    const op = gen(function* (): Generator<unknown, string, unknown> {
      yield* ch.send("first");
      yield* ch.send("second"); // dropped
      yield* ch.send("third"); // dropped
      return (yield* ch.receive) as string;
    });
    expect(await sched.run(op)).toBe("first");
  });

  test("multiple yields of receive after send all see the same value", async () => {
    const sched = new Scheduler(testLib);
    const ch = sched.makeChannel<number>();
    const op = gen(function* (): Generator<unknown, string, unknown> {
      yield* ch.send(42);
      const a = (yield* ch.receive) as number;
      const b = (yield* ch.receive) as number;
      const c = (yield* ch.receive) as number;
      return `${a}-${b}-${c}`;
    });
    expect(await sched.run(op)).toBe("42-42-42");
  });
});

describe("channel — composition with select for cancellation", () => {
  test("select(work, stop): work wins when stop is never sent", async () => {
    const sched = new Scheduler(testLib);
    const stop = sched.makeChannel<void>();
    const dWork = deferred<string>();
    const op = gen(function* (): Generator<unknown, string, unknown> {
      const r = yield* select({
        done: sched.makeJournalFuture(dWork.promise),
        stop: stop.receive,
      });
      switch (r.tag) {
        case "done":
          return `done:${(yield* r.future) as string}`;
        case "stop":
          return "stopped";
      }
    });
    const result = sched.run(op);
    queueMicrotask(() => dWork.resolve("complete"));
    expect(await result).toBe("done:complete");
  });

  test("select(work, stop): stop wins when send arrives first", async () => {
    const sched = new Scheduler(testLib);
    const stop = sched.makeChannel<void>();
    const dWork = deferred<string>();
    const op = gen(function* (): Generator<unknown, string, unknown> {
      yield* spawn(sender(stop, undefined));
      const r = yield* select({
        done: sched.makeJournalFuture(dWork.promise),
        stop: stop.receive,
      });
      switch (r.tag) {
        case "done":
          return `done:${(yield* r.future) as string}`;
        case "stop":
          return "stopped";
      }
    });
    expect(await sched.run(op)).toBe("stopped");
    dWork.resolve("never-seen");
  });

  test("cooperative cancellation across multiple steps: stop wins on second iteration", async () => {
    // Single-shot channels naturally support the select-in-a-loop
    // pattern. Once stop is sent, every subsequent select containing
    // stop.receive takes the stop branch immediately (the Future is
    // already settled).
    //
    // Ordering: we want step 1 to complete normally, then stop to fire
    // before step 2 progresses. The coordinator yields on dStep1 (the
    // same deferred the worker uses) so that the coordinator only
    // proceeds *after* the worker has consumed step 1, then it sends
    // stop.
    const sched = new Scheduler(testLib);
    const stop = sched.makeChannel<void>();
    const dStep1 = deferred<string>();
    const dStep2 = deferred<string>();

    const worker: Operation<string> = gen(function* (): Generator<
      unknown,
      string,
      unknown
    > {
      const collected: string[] = [];
      // Step 1.
      {
        const r = yield* select({
          done: sched.makeJournalFuture(dStep1.promise),
          stop: stop.receive,
        });
        if (r.tag === "stop") return `stopped-after:${collected.join(",")}`;
        collected.push((yield* r.future) as string);
      }
      // Step 2.
      {
        const r = yield* select({
          done: sched.makeJournalFuture(dStep2.promise),
          stop: stop.receive,
        });
        if (r.tag === "stop") return `stopped-after:${collected.join(",")}`;
        collected.push((yield* r.future) as string);
      }
      return `complete:${collected.join(",")}`;
    });

    const coordinator: Operation<void> = gen(function* () {
      // Yield on dStep1 so we only continue after the worker has
      // observed step 1 settling — the scheduler advances fibers in
      // insertion order, so the worker's step-1 wake fires before this
      // fiber's matching wake.
      yield* sched.makeJournalFuture(dStep1.promise);
      yield* stop.send();
    });

    const op = gen(function* (): Generator<unknown, string, unknown> {
      const t = (yield* spawn(worker)) as Future<string>;
      yield* spawn(coordinator);
      // dStep1 is a deferred (journal-backed) — resolving from a
      // microtask is fine.
      queueMicrotask(() => dStep1.resolve("a"));
      return (yield* t) as string;
    });
    expect(await sched.run(op)).toBe("stopped-after:a");
    dStep2.resolve("never");
  });

  test("worker can ignore stop and continue if it chooses", async () => {
    // Cooperative: the receiver decides what stop means. A worker
    // that wants to finish its committed work despite a stop signal
    // is free to do so.
    const sched = new Scheduler(testLib);
    const stop = sched.makeChannel<void>();
    const dWork = deferred<string>();

    const stubborn: Operation<string> = gen(function* (): Generator<
      unknown,
      string,
      unknown
    > {
      const r = yield* select({
        done: sched.makeJournalFuture(dWork.promise),
        stop: stop.receive,
      });
      if (r.tag === "stop") {
        const v = (yield* sched.makeJournalFuture(dWork.promise)) as string;
        return `ignored-stop:${v}`;
      }
      return `done:${(yield* r.future) as string}`;
    });

    const op = gen(function* (): Generator<unknown, string, unknown> {
      const t = (yield* spawn(stubborn)) as Future<string>;
      yield* spawn(sender(stop, undefined));
      // dWork is a deferred — resolving via queueMicrotask is fine.
      queueMicrotask(() =>
        queueMicrotask(() => queueMicrotask(() => dWork.resolve("finished")))
      );
      return (yield* t) as string;
    });
    expect(await sched.run(op)).toBe("ignored-stop:finished");
  });

  test("stop sent BEFORE select runs: stop branch wins immediately", async () => {
    // The user can send stop before the select; the worker's first
    // select will see stop.receive already settled and take the stop
    // branch synchronously.
    const sched = new Scheduler(testLib);
    const stop = sched.makeChannel<void>();
    const dWork = deferred<string>();
    const op = gen(function* (): Generator<unknown, string, unknown> {
      yield* stop.send(); // settle synchronously inside the gen body
      const r = yield* select({
        done: sched.makeJournalFuture(dWork.promise),
        stop: stop.receive,
      });
      return r.tag === "stop" ? "stopped" : "done";
    });
    expect(await sched.run(op)).toBe("stopped");
    dWork.resolve("never");
  });
});

describe("channel — race composition", () => {
  test("race(work, stop.receive): same as select but only the value", async () => {
    const sched = new Scheduler(testLib);
    const stop = sched.makeChannel<string>();
    const dWork = deferred<string>();
    const op = gen(function* (): Generator<unknown, string, unknown> {
      yield* spawn(sender(stop, "interrupt"));
      const winner = (yield* sched.race([
        sched.makeJournalFuture(dWork.promise),
        stop.receive,
      ])) as string;
      return winner;
    });
    expect(await sched.run(op)).toBe("interrupt");
    dWork.resolve("never");
  });

  test("multiple races against the same stop channel: each settles deterministically", async () => {
    const sched = new Scheduler(testLib);
    const stop = sched.makeChannel<string>();

    const op = gen(function* (): Generator<unknown, string, unknown> {
      // Two children, both racing their own work against the same stop.
      const dWorkA = deferred<string>();
      const dWorkB = deferred<string>();
      const childA: Operation<string> = gen(function* (): Generator<
        unknown,
        string,
        unknown
      > {
        const v = (yield* sched.race([
          sched.makeJournalFuture(dWorkA.promise),
          stop.receive,
        ])) as string;
        return `A:${v}`;
      });
      const childB: Operation<string> = gen(function* (): Generator<
        unknown,
        string,
        unknown
      > {
        const v = (yield* sched.race([
          sched.makeJournalFuture(dWorkB.promise),
          stop.receive,
        ])) as string;
        return `B:${v}`;
      });
      const ta = (yield* spawn(childA)) as Future<string>;
      const tb = (yield* spawn(childB)) as Future<string>;
      yield* spawn(sender(stop, "halt"));
      const a = (yield* ta) as string;
      const b = (yield* tb) as string;
      // Both children see the same stop value because receive is the
      // same Future on both.
      dWorkA.resolve("never1");
      dWorkB.resolve("never2");
      return `${a}|${b}`;
    });
    expect(await sched.run(op)).toBe("A:halt|B:halt");
  });
});

describe("channel — sharing across routines", () => {
  test("channel passed to a child routine: parent sends, child reads", async () => {
    const sched = new Scheduler(testLib);
    const ch = sched.makeChannel<string>();

    const reader: Operation<string> = gen(function* (): Generator<
      unknown,
      string,
      unknown
    > {
      const v = (yield* ch.receive) as string;
      return `read:${v}`;
    });

    const op = gen(function* (): Generator<unknown, string, unknown> {
      const t = (yield* spawn(reader)) as Future<string>;
      yield* spawn(sender(ch, "from-parent"));
      return (yield* t) as string;
    });
    expect(await sched.run(op)).toBe("read:from-parent");
  });

  test("multiple readers all see the same value (broadcast via single-shot semantics)", async () => {
    // Because receive is a settle-once Future, multiple readers all
    // resolve with the same value when send fires. Effectively a
    // one-time broadcast.
    const sched = new Scheduler(testLib);
    const ch = sched.makeChannel<string>();

    const reader = (label: string): Operation<string> =>
      gen(function* (): Generator<unknown, string, unknown> {
        const v = (yield* ch.receive) as string;
        return `${label}:${v}`;
      });

    const op = gen(function* (): Generator<unknown, string, unknown> {
      const ta = (yield* spawn(reader("A"))) as Future<string>;
      const tb = (yield* spawn(reader("B"))) as Future<string>;
      const tc = (yield* spawn(reader("C"))) as Future<string>;
      yield* spawn(sender(ch, "broadcast"));
      const a = (yield* ta) as string;
      const b = (yield* tb) as string;
      const c = (yield* tc) as string;
      return `${a}|${b}|${c}`;
    });
    expect(await sched.run(op)).toBe("A:broadcast|B:broadcast|C:broadcast");
  });
});
