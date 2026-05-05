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

// Test substrate: a controllable promise that satisfies the Awaitable<T>
// contract the scheduler depends on. Tests construct deferreds, build
// Futures from them via Scheduler.makeJournalFuture, then resolve/reject
// in whatever order they want.
//
// Behavior matches what the scheduler expects of RestatePromise:
//   - thenable (works with `await`)
//   - .map((v, e) => U) projects settled state into a new Awaitable
//   - static all/race over arrays
//
// Implementation note: TestPromise stores its inner native Promise so that
// testLib.all/race can unwrap to native Promises before calling
// Promise.all/race. Without this, Promise.race([thenable, thenable])
// schedules `.then` calls *asynchronously* (per spec, to safely handle
// arbitrary thenables), which interleaves badly with user-scheduled
// queueMicrotask calls in tests — the user's microtask can fire and
// settle a "slow" deferred *before* Promise.race's internal then-callbacks
// even register, defeating the race semantics tests want.

import type { Awaitable, AwaitableLib } from "../src/internal.js";
import type { FutureSettledResult } from "../src/index.js";

const innerPromise = Symbol("testPromiseInner");

class TestPromise<T> implements Awaitable<T> {
  readonly [innerPromise]: Promise<T>;

  constructor(inner: Promise<T>) {
    this[innerPromise] = inner;
  }

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?:
      | ((value: T) => TResult1 | PromiseLike<TResult1>)
      | null
      | undefined,
    onrejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | null
      | undefined
  ): PromiseLike<TResult1 | TResult2> {
    return this[innerPromise].then(onfulfilled, onrejected);
  }

  map<U>(f: (v: T | undefined, e: unknown) => U): Awaitable<U> {
    return new TestPromise<U>(
      this[innerPromise].then(
        (v) => f(v, undefined),
        (e) => f(undefined, e)
      )
    );
  }
}

function unwrap<T>(a: Awaitable<T>): Promise<T> {
  if (a instanceof TestPromise) return a[innerPromise];
  // Fallback for any non-TestPromise Awaitable: adapt via .then. This is
  // the path that introduces the microtask-ordering quirk; tests should
  // construct via deferred()/resolved() to ensure they get TestPromise.
  return Promise.resolve(a as PromiseLike<T>);
}

export type Deferred<T> = {
  promise: Awaitable<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
};

export function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const inner = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {
    promise: new TestPromise(inner),
    resolve,
    reject,
  };
}

export function resolved<T>(v: T): Awaitable<T> {
  return new TestPromise(Promise.resolve(v));
}

export function rejected<T = never>(e: unknown): Awaitable<T> {
  // Attach a no-op handler to avoid Node's unhandled-rejection warnings
  // before the scheduler attaches its own handlers.
  const p = Promise.reject<T>(e);
  p.catch(() => {});
  return new TestPromise(p);
}

export const testLib: AwaitableLib = {
  all<const T extends readonly Awaitable<unknown>[]>(
    items: T
  ): Awaitable<{ -readonly [P in keyof T]: Awaited<T[P]> }> {
    return new TestPromise(
      Promise.all(items.map(unwrap))
    ) as unknown as Awaitable<{
      -readonly [P in keyof T]: Awaited<T[P]>;
    }>;
  },
  race<const T extends readonly Awaitable<unknown>[]>(
    items: T
  ): Awaitable<Awaited<T[number]>> {
    return new TestPromise(
      Promise.race(items.map(unwrap))
    ) as unknown as Awaitable<Awaited<T[number]>>;
  },
  any<const T extends readonly Awaitable<unknown>[]>(
    items: T
  ): Awaitable<Awaited<T[number]>> {
    return new TestPromise(
      Promise.any(items.map(unwrap))
    ) as unknown as Awaitable<Awaited<T[number]>>;
  },
  allSettled<const T extends readonly Awaitable<unknown>[]>(
    items: T
  ): Awaitable<{
    -readonly [P in keyof T]: FutureSettledResult<Awaited<T[P]>>;
  }> {
    return new TestPromise(
      Promise.allSettled(items.map(unwrap))
    ) as unknown as Awaitable<{
      -readonly [P in keyof T]: FutureSettledResult<Awaited<T[P]>>;
    }>;
  },
  // The basic testLib never simulates invocation cancellation. Tests
  // that need to inject cancellation use `cancellingLib()` below.
  isCancellation: () => false,
};

// Test substrate that models the SDK's cancellation behavior. The lib's
// `race` produces promises that can be externally rejected via the
// returned `cancel(error)` function. Each call to cancel(e) settles the
// most recently created race promise (and any future ones until cancel
// is reset) with rejection `e`.
//
// This mirrors what the real SDK does: cancellation arriving while
// a RestatePromise.race is in flight settles that race promise with a
// TerminalError. The individual journal sources remain pending —
// only the aggregate race promise carries the rejection. New race
// promises constructed afterward are unaffected (start clean).
export type CancellingLib = {
  lib: AwaitableLib;
  // Reject the currently-pending race promise with `e`, marking `e` as
  // a cancellation so `lib.isCancellation(e)` returns true. Mirrors the
  // SDK's invocation-cancellation path. If called before any race
  // exists, the rejection is queued for the next race.
  cancel: (e: unknown) => void;
  // Same delivery mechanism as cancel(), but does NOT register `e` as a
  // cancellation. Use this to simulate unexpected race-level rejections
  // (transport errors, lib bugs) and verify the scheduler treats them
  // distinctly from cancellation — fanning out without aborting the
  // AbortController.
  rejectRace: (e: unknown) => void;
};

export function cancellingLib(): CancellingLib {
  // We track the most-recent race's reject hook, plus a pending-cancel
  // sentinel for "cancel was called before any race was constructed,
  // apply to the next one."
  let currentReject: ((e: unknown) => void) | null = null;
  let pendingCancelError: { e: unknown } | null = null;
  // Errors injected via cancel() are stamped here so isCancellation can
  // distinguish them from other rejections that may flow through the
  // lib (e.g. a directly-rejected journal source).
  const cancelledErrors = new Set<unknown>();

  const lib: AwaitableLib = {
    all<const T extends readonly Awaitable<unknown>[]>(
      items: T
    ): Awaitable<{ -readonly [P in keyof T]: Awaited<T[P]> }> {
      return new TestPromise(
        Promise.all(items.map(unwrap))
      ) as unknown as Awaitable<{
        -readonly [P in keyof T]: Awaited<T[P]>;
      }>;
    },
    any<const T extends readonly Awaitable<unknown>[]>(
      items: T
    ): Awaitable<Awaited<T[number]>> {
      return new TestPromise(
        Promise.any(items.map(unwrap))
      ) as unknown as Awaitable<Awaited<T[number]>>;
    },
    allSettled<const T extends readonly Awaitable<unknown>[]>(
      items: T
    ): Awaitable<{
      -readonly [P in keyof T]: FutureSettledResult<Awaited<T[P]>>;
    }> {
      return new TestPromise(
        Promise.allSettled(items.map(unwrap))
      ) as unknown as Awaitable<{
        -readonly [P in keyof T]: FutureSettledResult<Awaited<T[P]>>;
      }>;
    },
    isCancellation(e: unknown): boolean {
      return cancelledErrors.has(e);
    },
    race<const T extends readonly Awaitable<unknown>[]>(
      items: T
    ): Awaitable<Awaited<T[number]>> {
      // Race the user's items against a cancel-deferred. Whichever fires
      // first wins. If cancel fires, the race rejects with the cancel error.
      let cancelReject!: (e: unknown) => void;
      const cancelPromise = new Promise<never>((_res, rej) => {
        cancelReject = rej;
      });
      // Avoid unhandled-rejection warnings if cancel never fires for this
      // race.
      cancelPromise.catch(() => {});

      currentReject = cancelReject;

      // If cancel was queued before this race existed, deliver it now.
      if (pendingCancelError) {
        const e = pendingCancelError.e;
        pendingCancelError = null;
        cancelReject(e);
      }

      const inner = Promise.race([
        ...items.map(unwrap),
        cancelPromise,
      ]) as Promise<Awaited<T[number]>>;
      // Detach currentReject when this race settles, so future cancels
      // don't accidentally target a stale race. Use .then with handlers
      // for both branches and silence the resulting chain to avoid
      // unhandled-rejection warnings — the actual rejection is observed
      // by whoever awaits the returned TestPromise (the scheduler).
      inner.then(
        () => {
          if (currentReject === cancelReject) currentReject = null;
        },
        () => {
          if (currentReject === cancelReject) currentReject = null;
        }
      );
      return new TestPromise(inner) as unknown as Awaitable<Awaited<T[number]>>;
    },
  };

  const deliver = (e: unknown): void => {
    if (currentReject) {
      const f = currentReject;
      currentReject = null;
      f(e);
    } else {
      // Queue for the next race that gets constructed.
      pendingCancelError = { e };
    }
  };

  const cancel = (e: unknown): void => {
    cancelledErrors.add(e);
    deliver(e);
  };

  const rejectRace = (e: unknown): void => {
    deliver(e);
  };

  return { lib, cancel, rejectRace };
}
