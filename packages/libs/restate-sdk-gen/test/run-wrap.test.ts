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

// Tests for `wrapActionForCancellation`, the production wrapper around
// user-supplied `ops.run` closures.
//
// Why this exists: when invocation cancellation aborts the AbortController,
// any AbortSignal-aware syscall inside the closure (e.g. fetch) throws an
// AbortError. AbortError is a non-terminal error in Restate's view and
// would be retryable — but the invocation is being cancelled, so retries
// are pointless and pollute the journal.
//
// The wrapper checks `signal.aborted` on the closure's throw path. If
// the signal aborted during execution, the wrapper rethrows
// `signal.reason` (the TerminalError set by the scheduler when it
// observed cancellation). The journal records a single terminal
// cancellation, no retries.
//
// What the wrapper deliberately does NOT do:
//   - Touch the success path. Closures that catch abort internally and
//     return a value normally are unaffected.
//   - Distinguish AbortError from other errors thrown after abort.
//     Once the signal is aborted, the failure outcome IS cancellation;
//     fine-grained classification adds complexity for no benefit since
//     the routine-level cancellation will surface anyway.

import { describe, expect, test } from "vitest";
import { TerminalError } from "@restatedev/restate-sdk";
import { wrapActionForCancellation } from "../src/index.js";

// Stand-in for DOMException("...", "AbortError") — what fetch throws on
// abort. Avoids depending on the DOM lib in tsc; identical at runtime.
function abortError(message = "aborted"): Error {
  const e = new Error(message);
  e.name = "AbortError";
  return e;
}

function makeSignal(): {
  signal: AbortSignal;
  abort: (reason: unknown) => void;
} {
  const c = new AbortController();
  return { signal: c.signal, abort: (r) => c.abort(r) };
}

describe("wrapActionForCancellation — success path", () => {
  test("closure that returns a value normally is unaffected", async () => {
    const { signal } = makeSignal();
    const wrapped = wrapActionForCancellation(signal, async () => "ok");
    expect(await wrapped()).toBe("ok");
  });

  test("closure that catches abort internally and returns is unaffected", async () => {
    // Even after abort, if the closure decides to return a value, the
    // wrapper does not interfere — we only intervene on throw paths.
    const { signal, abort } = makeSignal();
    const wrapped = wrapActionForCancellation(signal, async ({ signal }) => {
      try {
        // Simulate an abort-aware operation.
        await new Promise<void>((res, rej) => {
          signal.addEventListener("abort", () =>
            rej(abortError("aborted"))
          );
        });
        return "never";
      } catch {
        return "caught-and-returned";
      }
    });
    queueMicrotask(() => abort(new TerminalError("Cancelled")));
    expect(await wrapped()).toBe("caught-and-returned");
  });
});

describe("wrapActionForCancellation — throw path with abort", () => {
  test("throwing AbortError after abort surfaces signal.reason", async () => {
    const { signal, abort } = makeSignal();
    const reason = new TerminalError("Invocation cancelled");
    const wrapped = wrapActionForCancellation(signal, async () => {
      // Wait for abort, then throw AbortError as fetch would.
      await new Promise<void>((_res, _rej) => {
        signal.addEventListener("abort", () => {
          throw abortError("aborted");
        });
      });
      // This await never resolves; the throw above happens inside the
      // event handler, which is asynchronous to the await. So actually
      // we need to construct this differently.
      return "never-reached";
    });
    // Different shape — directly fail after abort.
    const wrapped2 = wrapActionForCancellation(signal, async () => {
      await new Promise<void>((res) => setTimeout(res, 10));
      // By now abort has fired (queued below).
      throw abortError("aborted");
    });
    queueMicrotask(() => abort(reason));
    await expect(wrapped2()).rejects.toBe(reason);
    // Sanity: the original wrapped also doesn't matter for this test.
    void wrapped;
  });

  test("throwing any error after abort surfaces signal.reason (over-conversion is OK)", async () => {
    // We deliberately don't classify the thrown error — any throw after
    // abort surfaces signal.reason. Worst case: a coincidental real
    // error gets misattributed as cancellation, but the routine sees
    // cancellation TerminalError at its yield anyway, so the journal
    // outcome is correct.
    const { signal, abort } = makeSignal();
    const reason = new TerminalError("Cancelled");
    const wrapped = wrapActionForCancellation(signal, async () => {
      await new Promise<void>((res) => setTimeout(res, 10));
      throw new Error("totally-different-error");
    });
    queueMicrotask(() => abort(reason));
    await expect(wrapped()).rejects.toBe(reason);
  });

  test("throwing before abort fires propagates the original error", async () => {
    const { signal } = makeSignal();
    void signal;
    const original = new Error("validation-failed");
    const wrapped = wrapActionForCancellation(signal, async () => {
      throw original;
    });
    await expect(wrapped()).rejects.toBe(original);
  });

  test("throwing after abort fires (synchronous abort path)", async () => {
    // Abort happens before the closure starts; closure throws something
    // unrelated. signal.aborted is true on the throw, so we surface
    // the abort reason.
    const { signal, abort } = makeSignal();
    const reason = new TerminalError("Cancelled");
    abort(reason);
    expect(signal.aborted).toBe(true);
    const wrapped = wrapActionForCancellation(signal, async () => {
      throw new Error("anything");
    });
    await expect(wrapped()).rejects.toBe(reason);
  });
});

describe("wrapActionForCancellation — opts object passed correctly", () => {
  test("the closure receives an opts object with signal", async () => {
    const { signal } = makeSignal();
    let received: AbortSignal | null = null;
    const wrapped = wrapActionForCancellation(signal, async (opts) => {
      received = opts.signal;
      return "ok";
    });
    await wrapped();
    expect(received).toBe(signal);
  });

  test("opts object is fresh-shaped — extending it later won't break callers", async () => {
    // Future-proofing: closures destructure `{ signal }`. If we add new
    // fields to RunActionOpts later, existing closures should be
    // unaffected. This test just documents the intent — TypeScript
    // enforces the contract.
    const { signal } = makeSignal();
    const wrapped = wrapActionForCancellation(signal, async ({ signal }) => {
      return signal.aborted ? "aborted" : "fine";
    });
    expect(await wrapped()).toBe("fine");
  });
});

describe("wrapActionForCancellation — interaction with race outcomes", () => {
  test("closure returns successfully even after abort fires (race not lost)", async () => {
    // Edge case: closure was already resolving when abort fires. The
    // microsecond-scale race between "abort signal fires" and "closure
    // resolves" can go either way. If the closure resolves first, the
    // success path runs and the wrapper returns the value.
    const { signal, abort } = makeSignal();
    const wrapped = wrapActionForCancellation(signal, async () => {
      // Closure returns synchronously after one microtask.
      return "fast";
    });
    const promise = wrapped();
    abort(new TerminalError("Cancelled"));
    expect(await promise).toBe("fast");
  });
});

describe("wrapActionForCancellation — reason swallowing scenarios", () => {
  test("closure that wraps AbortError in another error: outer reason still surfaces", async () => {
    // Common pattern: catch fetch's AbortError, rethrow with context.
    // The wrapper sees the wrapped error on throw, but checks
    // signal.aborted (not the error type), so it correctly surfaces
    // signal.reason.
    const { signal, abort } = makeSignal();
    const reason = new TerminalError("Cancelled");
    const wrapped = wrapActionForCancellation(signal, async ({ signal }) => {
      try {
        await new Promise<void>((_res, rej) => {
          signal.addEventListener("abort", () =>
            rej(abortError("aborted"))
          );
        });
        return "never";
      } catch (e) {
        // User wraps the abort error.
        throw new Error(`wrapped: ${(e as Error).message}`);
      }
    });
    queueMicrotask(() => abort(reason));
    await expect(wrapped()).rejects.toBe(reason);
  });

  test("closure that catches abort and returns: success path bypasses wrapper", async () => {
    // Documented behavior: closures that catch abort internally and
    // return a value are unaffected. The journal records the return
    // value. This is intentional — the closure made a choice.
    const { signal, abort } = makeSignal();
    const wrapped = wrapActionForCancellation(signal, async ({ signal }) => {
      try {
        await new Promise<void>((_res, rej) => {
          signal.addEventListener("abort", () =>
            rej(abortError("aborted"))
          );
        });
        return "never";
      } catch {
        return "swallowed";
      }
    });
    queueMicrotask(() => abort(new TerminalError("Cancelled")));
    expect(await wrapped()).toBe("swallowed");
  });

  test("closure throws TerminalError unrelated to cancellation, signal not aborted: original error propagates", async () => {
    // Validation-style TerminalError before any cancel: should NOT be
    // shadowed. signal.aborted is false, so wrapper takes throw path
    // unmodified.
    const { signal } = makeSignal();
    const validationErr = new TerminalError("bad input", { errorCode: 400 });
    const wrapped = wrapActionForCancellation(signal, async () => {
      throw validationErr;
    });
    await expect(wrapped()).rejects.toBe(validationErr);
  });

  test("closure throws TerminalError after abort fires: cancellation reason shadows the user error", async () => {
    // Documented limitation: a closure that throws its own TerminalError
    // *after* abort fires gets its error shadowed by the cancellation
    // reason. This is the rare case where information is lost; we
    // accept this because the routine sees CANCELLED at its yield
    // anyway and the workflow is being torn down.
    const { signal, abort } = makeSignal();
    const cancelReason = new TerminalError("Cancelled");
    const userError = new TerminalError("bad input", { errorCode: 400 });
    abort(cancelReason);
    expect(signal.aborted).toBe(true);
    const wrapped = wrapActionForCancellation(signal, async () => {
      throw userError;
    });
    await expect(wrapped()).rejects.toBe(cancelReason);
  });

  test("closure uses inner AbortController plumbed from outer signal: outer reason still surfaces", async () => {
    // User pattern: make a local AbortController whose abort is wired
    // to our signal. fetch sees the local signal and throws AbortError
    // when the local controller aborts. Wrapper checks the OUTER
    // signal we passed in — that's still aborted, so it surfaces our
    // reason regardless of what the inner local controller's reason was.
    const { signal, abort } = makeSignal();
    const reason = new TerminalError("Cancelled");
    const wrapped = wrapActionForCancellation(signal, async ({ signal }) => {
      const local = new AbortController();
      signal.addEventListener("abort", () => local.abort()); // no reason!
      // Wait for local to abort, then throw.
      await new Promise<void>((_res, rej) => {
        local.signal.addEventListener("abort", () =>
          rej(abortError("aborted"))
        );
      });
      return "never";
    });
    queueMicrotask(() => abort(reason));
    await expect(wrapped()).rejects.toBe(reason);
  });
});

describe("wrapActionForCancellation — defensive coercion of non-TerminalError reason", () => {
  test("non-TerminalError reason gets coerced to CancelledError on throw path", async () => {
    // The scheduler's catch path fires for any race rejection — most
    // are TerminalError(CANCELLED) from the SDK, but in principle a
    // non-cancellation race rejection could fire too. The wrapper
    // must always rethrow a *terminal* error so the journal doesn't
    // record a retryable outcome against a cancelled invocation.
    const { signal, abort } = makeSignal();
    const nonTerminal = new Error("not-terminal");
    abort(nonTerminal);
    const wrapped = wrapActionForCancellation(signal, async () => {
      throw new Error("any");
    });
    let caught: unknown;
    try {
      await wrapped();
    } catch (e) {
      caught = e;
    }
    // Wrapper must convert to a TerminalError (specifically,
    // CancelledError, the SDK's canonical type).
    // Note: we can't import the real CancelledError from this test
    // file without depending on the SDK directly — instead, check the
    // structural property: it has `code === 409` and looks
    // TerminalError-shaped.
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).name).toBe("CancelledError");
    expect((caught as { code: number }).code).toBe(409);
  });
});
