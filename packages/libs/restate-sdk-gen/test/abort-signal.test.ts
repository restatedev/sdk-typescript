// AbortSignal tests.
//
// The scheduler exposes an AbortSignal (via `sched.abortSignal`) that
// fires when invocation cancellation is observed. The signal serves
// two purposes:
//
//   1. Inside ops.run closures (production), the signal is passed as
//      the action's argument, so AbortSignal-aware APIs like fetch(url,
//      { signal }) can abort their in-flight work.
//
//   2. As a queryable property anywhere in the workflow body, so pure-JS
//      sections can short-circuit. Tests below exercise this via
//      sched.abortSignal directly.
//
// Behavior properties:
//
//   - Starts unaborted.
//   - Aborts when the main-loop race promise is rejected (cancellation).
//   - The abort reason is the rejection error itself (a TerminalError in
//     production; here, our test-substitute error class).
//   - Aborts BEFORE the cancellation TerminalError is fanned out to
//     parked routines — this is the agreed timing so in-flight syscalls
//     start cancelling immediately, ahead of the routine-wake microsecond.
//   - Idempotent: multiple cancellations don't re-abort an already-
//     aborted signal.

import { describe, expect, test } from "vitest";
import {
  gen,
  type Operation,
} from "../src/index.js";
import {
  Scheduler,
} from "../src/internal.js";
import { cancellingLib, deferred } from "./test-promise.js";

class CancelError extends Error {
  readonly code = "CANCELLED";
  constructor(message = "Invocation cancelled") {
    super(message);
    this.name = "TerminalError";
  }
}

describe("abortSignal — initial state and cancellation observation", () => {
  test("signal starts unaborted", () => {
    const { lib } = cancellingLib();
    const sched = new Scheduler(lib);
    expect(sched.abortSignal.aborted).toBe(false);
    expect(sched.abortSignal.reason).toBeUndefined();
  });

  test("signal becomes aborted when cancellation arrives, with the rejection as reason", async () => {
    const { lib, cancel } = cancellingLib();
    const sched = new Scheduler(lib);
    const dWork = deferred<string>();
    const cancelErr = new CancelError();
    let capturedSignal: AbortSignal | null = null;

    const op = gen(function* (): Generator<unknown, string, unknown> {
      // Capture the signal *before* cancellation. This represents the
      // typical pattern: an ops.run closure receives signal at the
      // moment its work is constructed; when cancellation arrives,
      // that captured signal aborts.
      capturedSignal = sched.abortSignal;
      try {
        return (yield* sched.makeJournalFuture(dWork.promise)) as string;
      } catch {
        // The captured signal must now report aborted with the cancel
        // error as reason. (We don't query sched.abortSignal here —
        // by the time the catch block runs, the scheduler has already
        // replaced its controller with a fresh one.)
        if (capturedSignal === null) return "ERROR-no-capture";
        if (!capturedSignal.aborted) return "ERROR-not-aborted";
        if (capturedSignal.reason !== cancelErr) {
          return "ERROR-wrong-reason";
        }
        return "ok-aborted";
      }
    });

    const result = sched.run(op);
    queueMicrotask(() => cancel(cancelErr));
    expect(await result).toBe("ok-aborted");
    dWork.resolve("late");
  });

  test("signal is non-sticky: after recovery, a fresh signal is returned", async () => {
    const { lib, cancel } = cancellingLib();
    const sched = new Scheduler(lib);
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    let signalBeforeCancel: AbortSignal | null = null;
    let signalAfterRecovery: AbortSignal | null = null;

    const op = gen(function* (): Generator<unknown, string, unknown> {
      // Capture the signal that the first ops.run-style work would see.
      signalBeforeCancel = sched.abortSignal;
      try {
        yield* sched.makeJournalFuture(d1.promise);
      } catch {
        // Ignore — we expect the cancel.
      }
      // After the catch, in cleanup-style work, capture the signal
      // again. It must be a *different*, unaborted signal — cancellation
      // is not a sticky state.
      signalAfterRecovery = sched.abortSignal;
      const v = (yield* sched.makeJournalFuture(d2.promise)) as string;
      return v;
    });

    const result = sched.run(op);
    queueMicrotask(() => cancel(new CancelError()));
    queueMicrotask(() => queueMicrotask(() => d2.resolve("recovered")));
    expect(await result).toBe("recovered");
    // The first captured signal should now be aborted (it was the
    // signal whose ops.run was caught by the cancel).
    const before = signalBeforeCancel as AbortSignal | null;
    const after = signalAfterRecovery as AbortSignal | null;
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(before!.aborted).toBe(true);
    // The signal captured after recovery must be a *different* signal
    // and must NOT be aborted.
    expect(after).not.toBe(before);
    expect(after!.aborted).toBe(false);
    d1.resolve("late");
  });
});

describe("abortSignal — timing relative to fan-out", () => {
  test("signal captured before cancel is aborted by the time catch runs", async () => {
    // The agreed ordering: abort first, then deliver TerminalError to
    // parked routines. So when a routine's catch block runs, the
    // signal it captured before yielding is already aborted.
    const { lib, cancel } = cancellingLib();
    const sched = new Scheduler(lib);
    const dWork = deferred<string>();
    let capturedSignal: AbortSignal | null = null;
    let abortedAtCatch = false;

    const op = gen(function* (): Generator<unknown, string, unknown> {
      capturedSignal = sched.abortSignal;
      try {
        return (yield* sched.makeJournalFuture(dWork.promise)) as string;
      } catch {
        abortedAtCatch = capturedSignal?.aborted ?? false;
        return "x";
      }
    });

    const result = sched.run(op);
    queueMicrotask(() => cancel(new CancelError()));
    await result;
    expect(abortedAtCatch).toBe(true);
    dWork.resolve("late");
  });
});

describe("abortSignal — idempotence and multi-cancel", () => {
  test("two sequential cancellations: each captures its own signal with its own reason", async () => {
    // With non-sticky cancellation, each cancel event gets a fresh
    // AbortController. So if a routine captures the signal before
    // yielding, then catches a cancel, then captures the signal again
    // before yielding again, the two captures are different signals
    // with different reasons.
    const { lib, cancel } = cancellingLib();
    const sched = new Scheduler(lib);
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    const d3 = deferred<string>();
    const captures: { signal: AbortSignal; reason: unknown }[] = [];

    const op = gen(function* (): Generator<unknown, string, unknown> {
      const s1 = sched.abortSignal;
      try {
        yield* sched.makeJournalFuture(d1.promise);
      } catch {
        captures.push({ signal: s1, reason: s1.reason });
      }
      const s2 = sched.abortSignal;
      try {
        yield* sched.makeJournalFuture(d2.promise);
      } catch {
        captures.push({ signal: s2, reason: s2.reason });
      }
      const v = (yield* sched.makeJournalFuture(d3.promise)) as string;
      return v;
    });

    const first = new CancelError("first");
    const second = new CancelError("second");

    const result = sched.run(op);
    queueMicrotask(() => cancel(first));
    queueMicrotask(() =>
      queueMicrotask(() => queueMicrotask(() => cancel(second)))
    );
    queueMicrotask(() =>
      queueMicrotask(() =>
        queueMicrotask(() =>
          queueMicrotask(() =>
            queueMicrotask(() => queueMicrotask(() => d3.resolve("third")))
          )
        )
      )
    );
    expect(await result).toBe("third");
    // Each capture should be a distinct signal carrying its own reason.
    expect(captures.length).toBe(2);
    expect(captures[0]!.signal).not.toBe(captures[1]!.signal);
    expect(captures[0]!.reason).toBe(first);
    expect(captures[1]!.reason).toBe(second);
    d1.resolve("late1");
    d2.resolve("late2");
  });
});

describe("abortSignal — listener-based observation", () => {
  test("addEventListener fires once when abort happens", async () => {
    const { lib, cancel } = cancellingLib();
    const sched = new Scheduler(lib);
    const dWork = deferred<string>();
    let listenerCalls = 0;
    sched.abortSignal.addEventListener("abort", () => {
      listenerCalls++;
    });

    const op = gen(function* (): Generator<unknown, string, unknown> {
      try {
        return (yield* sched.makeJournalFuture(dWork.promise)) as string;
      } catch {
        return "caught";
      }
    });

    const result = sched.run(op);
    queueMicrotask(() => cancel(new CancelError()));
    await result;
    expect(listenerCalls).toBe(1);
    dWork.resolve("late");
  });
});

describe("abortSignal — closure receives signal as argument", () => {
  // ops.run is the production wrapper; in pure scheduler tests we
  // construct journal futures directly via makeJournalFuture and don't
  // exercise a closure-runner. But we can simulate the pattern by
  // having a "fake ops.run" helper that mirrors the production
  // behavior — pass sched.abortSignal into the action.
  test("a simulated ops.run-style closure observes the signal it receives", async () => {
    const { lib, cancel } = cancellingLib();
    const sched = new Scheduler(lib);
    let closureSawAbort = false;

    // Simulate an ops.run closure that's running while cancellation
    // arrives. The closure's deferred resolves only after the abort
    // signal fires; the closure observes it via the signal it was
    // given.
    const dClosureReady = deferred<string>();
    const closureFuture = sched.makeJournalFuture(dClosureReady.promise);

    // Spawn a "watchdog" routine that observes the signal and resolves
    // the closure's deferred when abort fires. This stands in for what
    // a fetch(url, {signal}) call would do automatically.
    const watchdog = (signal: AbortSignal): Operation<void> => {
      const dDone = deferred<void>();
      signal.addEventListener("abort", () => {
        closureSawAbort = signal.aborted;
        dClosureReady.resolve("aborted-result");
        dDone.resolve();
      });
      return gen(function* (): Generator<unknown, void, unknown> {
        yield* sched.makeJournalFuture(dDone.promise);
      });
    };

    const op = gen(function* (): Generator<unknown, string, unknown> {
      // Set up the watchdog before yielding.
      const wf = sched.spawnDetached(watchdog(sched.abortSignal));
      void wf;
      try {
        return (yield* closureFuture) as string;
      } catch {
        return "caught-via-yield";
      }
    });

    const result = sched.run(op);
    queueMicrotask(() => cancel(new CancelError()));
    // The race rejects → scheduler aborts signal → watchdog listener
    // fires → resolves closure's deferred. But the rejection was
    // delivered to the routine BEFORE the watchdog's resolve takes
    // effect (because abort is sync inside the catch block, but the
    // routine wake happens before drainReady returns control to the
    // event loop). So the routine catches the cancel via the yield
    // rejection. Either way: closureSawAbort must be true.
    const final = await result;
    expect(closureSawAbort).toBe(true);
    // Result will be "caught-via-yield" because the cancellation
    // delivers TerminalError before the watchdog's resolve has any
    // visible effect.
    expect(final).toBe("caught-via-yield");
  });
});

// ---------------------------------------------------------------------------
// Only cancellation errors trigger the AbortController.
//
// The scheduler's main-loop catch fans out *every* race rejection to
// parked fibers (so they can react / catch / cleanup). But it only
// aborts the AbortController when the rejection is classified as a
// cancellation by `lib.isCancellation(e)`.
//
// Rationale: the controller's signal is the SDK-cancellation signal —
// `ops.run({ signal })` closures use it to abort in-flight syscalls.
// A non-cancellation rejection (transport bug, lib failure) still has
// to wake parked fibers (otherwise they're stuck), but it must NOT
// pretend a cancellation happened — closures with captured signals
// would otherwise abort themselves spuriously.
// ---------------------------------------------------------------------------

describe("abortSignal — only cancellation errors trigger the abort controller", () => {
  test("cancellation rejection: signal aborts and reason matches", async () => {
    const { lib, cancel } = cancellingLib();
    const sched = new Scheduler(lib);
    const dWork = deferred<string>();
    const cancelErr = new CancelError();
    let captured: AbortSignal | null = null;

    const op = gen(function* (): Generator<unknown, string, unknown> {
      captured = sched.abortSignal;
      try {
        return (yield* sched.makeJournalFuture(dWork.promise)) as string;
      } catch {
        return "caught";
      }
    });

    const result = sched.run(op);
    queueMicrotask(() => cancel(cancelErr));
    await result;
    expect(captured!.aborted).toBe(true);
    expect(captured!.reason).toBe(cancelErr);
    dWork.resolve("late");
  });

  test("non-cancellation rejection: error fans out but signal stays unaborted", async () => {
    // Capture the signal before the rejection, fan out a non-
    // cancellation error via rejectRace (which doesn't mark the error
    // as a cancellation). The routine's catch must observe the error
    // (proving fan-out happened), but the captured signal must NOT be
    // aborted (proving the controller wasn't touched).
    const { lib, rejectRace } = cancellingLib();
    const sched = new Scheduler(lib);
    const dWork = deferred<string>();
    const transportErr = new Error("transport-broke");
    let captured: AbortSignal | null = null;
    let caughtMessage: string | null = null;

    const op = gen(function* (): Generator<unknown, string, unknown> {
      captured = sched.abortSignal;
      try {
        return (yield* sched.makeJournalFuture(dWork.promise)) as string;
      } catch (e) {
        caughtMessage = (e as Error).message;
        return "caught";
      }
    });

    const result = sched.run(op);
    queueMicrotask(() => rejectRace(transportErr));
    expect(await result).toBe("caught");
    // Fan-out delivered the error.
    expect(caughtMessage).toBe("transport-broke");
    // The captured signal is the controller that was current during
    // the non-cancellation rejection. It must remain unaborted —
    // closures with captured signals would otherwise spuriously
    // abort themselves.
    expect(captured!.aborted).toBe(false);
    expect(captured!.reason).toBeUndefined();
    dWork.resolve("late");
  });

  test("non-cancellation rejection does not replace the controller", async () => {
    // Capture the signal both before and after a non-cancellation
    // rejection. The same controller must still be in use — only
    // actual cancellation triggers the replace-with-fresh dance.
    const { lib, rejectRace } = cancellingLib();
    const sched = new Scheduler(lib);
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    let beforeReject: AbortSignal | null = null;
    let afterReject: AbortSignal | null = null;

    const op = gen(function* (): Generator<unknown, string, unknown> {
      beforeReject = sched.abortSignal;
      try {
        yield* sched.makeJournalFuture(d1.promise);
      } catch {
        // expected
      }
      afterReject = sched.abortSignal;
      const v = (yield* sched.makeJournalFuture(d2.promise)) as string;
      return v;
    });

    const result = sched.run(op);
    queueMicrotask(() => rejectRace(new Error("transport")));
    queueMicrotask(() => queueMicrotask(() => d2.resolve("ok")));
    expect(await result).toBe("ok");

    // Same controller before and after — non-cancellation must not
    // replace it.
    expect(afterReject).toBe(beforeReject);
    expect(beforeReject!.aborted).toBe(false);
    d1.resolve("late");
  });

  test("mixed: non-cancellation leaves controller intact; real cancel replaces it", async () => {
    // Walk both code paths in one test. After a non-cancellation
    // rejection: same controller, unaborted. After a subsequent
    // cancellation: the previously-captured controller is now aborted,
    // and sched.abortSignal returns a fresh, unaborted one.
    const { lib, cancel, rejectRace } = cancellingLib();
    const sched = new Scheduler(lib);
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    const cancelErr = new CancelError();
    let beforeNonCancel: AbortSignal | null = null;
    let afterNonCancel: AbortSignal | null = null;
    let afterCancel: AbortSignal | null = null;

    const op = gen(function* (): Generator<unknown, string, unknown> {
      beforeNonCancel = sched.abortSignal;
      try {
        yield* sched.makeJournalFuture(d1.promise);
      } catch {
        // expected: transport error
      }
      afterNonCancel = sched.abortSignal;
      try {
        yield* sched.makeJournalFuture(d2.promise);
      } catch {
        // expected: cancel
      }
      afterCancel = sched.abortSignal;
      return "done";
    });

    const result = sched.run(op);
    queueMicrotask(() => rejectRace(new Error("transport")));
    queueMicrotask(() =>
      queueMicrotask(() => queueMicrotask(() => cancel(cancelErr)))
    );
    await result;

    // Non-cancellation: same controller (no replacement happened).
    // We can't assert `aborted === false` here because the subsequent
    // cancel has already aborted this same controller by the time we
    // check — the prior test "non-cancellation rejection does not
    // replace the controller" covers that property in isolation.
    expect(afterNonCancel).toBe(beforeNonCancel);

    // Cancellation: replaced. The previously-current controller (the
    // one we captured as afterNonCancel) is now aborted with the
    // cancel error as reason. The fresh one returned afterwards is
    // unaborted.
    expect(afterCancel).not.toBe(afterNonCancel);
    expect(afterNonCancel!.aborted).toBe(true);
    expect(afterNonCancel!.reason).toBe(cancelErr);
    expect(afterCancel!.aborted).toBe(false);

    d1.resolve("late1");
    d2.resolve("late2");
  });

  test("listener fires only on cancellation, not on non-cancellation rejection", async () => {
    // Attach an abort listener; trigger a non-cancellation rejection
    // first, then a real cancellation. The listener must fire exactly
    // once — on the real cancel.
    const { lib, cancel, rejectRace } = cancellingLib();
    const sched = new Scheduler(lib);
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    let listenerCalls = 0;

    sched.abortSignal.addEventListener("abort", () => {
      listenerCalls++;
    });

    const op = gen(function* (): Generator<unknown, string, unknown> {
      try {
        yield* sched.makeJournalFuture(d1.promise);
      } catch {
        // transport
      }
      try {
        yield* sched.makeJournalFuture(d2.promise);
      } catch {
        // cancel
      }
      return "done";
    });

    const result = sched.run(op);
    queueMicrotask(() => rejectRace(new Error("transport")));
    queueMicrotask(() =>
      queueMicrotask(() => queueMicrotask(() => cancel(new CancelError())))
    );
    await result;
    expect(listenerCalls).toBe(1);
    d1.resolve("late1");
    d2.resolve("late2");
  });
});
