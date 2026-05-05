// Signal-sharing combinator e2e.
//
// Tests that the same `Future<T>` can be shared across multiple concurrent
// combinators — both `race` and `allSettled`/`all` — and that the
// memoized-settle semantics hold under replay.
//
// Two scenarios (ported from the SDK's combinator test suite):
//
//   1. allSettled(race(p1, p2), race(p1, p3)) — p1 is shared between both
//      races. When p1 fires first, both races should settle with p1's value.
//
//   2. all(race(p1-that-throws, p2), race(p1, p3)) — same sharing, but the
//      first race's p1 path is transformed via a spawned routine to always
//      throw TerminalError. The all should therefore reject.
//
// The inactivity timeout is simulated by a `sleep(1 ms)` after the main
// combinator, which forces a suspension so alwaysReplay mode exercises full
// journal replay for both tests.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import * as restate from "@restatedev/restate-sdk";
import * as clients from "@restatedev/restate-sdk-clients";
import { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";

let idempotencyKeySeq = 0;
const idem = () =>
  clients.SendOpts.from({ idempotencyKey: `test-${++idempotencyKeySeq}` });
import {
  gen,
  execute,
  spawn,
  signal,
  sleep,
  all,
  allSettled,
  race,
  type FutureSettledResult,
} from "@restatedev/restate-sdk-gen";

// ---------------------------------------------------------------------------
// Helper: send a named signal to a target invocation.
// ---------------------------------------------------------------------------

const signalSenderSvc = restate.service({
  name: "signalSender",
  handlers: {
    resolve: async (
      ctx: restate.Context,
      req: { invocationId: string; name: string; value: string }
    ): Promise<void> => {
      const ctxInternal = ctx as restate.internal.ContextInternal;
      ctxInternal
        .invocation(restate.InvocationIdParser.fromString(req.invocationId))
        .signal<string>(req.name)
        .resolve(req.value);
    },
  },
});

// ---------------------------------------------------------------------------
// The workflows under test.
// ---------------------------------------------------------------------------

const combinatorSvc = restate.service({
  name: "signalCombinator",
  handlers: {
    // allSettled(race(p1, p2), race(p1, p3))
    //
    // p1 is the same Future shared across both races. When p1 settles first,
    // both races should report fulfilled with p1's value.
    allSettledSharedSignal: async (
      ctx: restate.Context
    ): Promise<FutureSettledResult<string>[]> =>
      execute(
        ctx,
        gen(function* () {
          const p1 = signal<string>("p1");
          const p2 = signal<string>("p2");
          const p3 = signal<string>("p3");

          const results = yield* allSettled([race([p1, p2]), race([p1, p3])]);

          // Force a suspension so alwaysReplay exercises full journal replay.
          yield* sleep({ milliseconds: 1 });

          return results as FutureSettledResult<string>[];
        })
      ),

    // all(race(spawn-that-throws-after-p1, p2), race(p1, p3))
    //
    // The first race uses a spawned routine that waits for p1 then
    // unconditionally throws TerminalError — equivalent to the SDK's
    // `p1.map(() => { throw new TerminalError("p1 completed") })`.
    // When p1 fires first, the spawned routine throws, race1 rejects,
    // and `all` propagates the rejection.
    allWithMappedSignal: async (ctx: restate.Context): Promise<string[]> =>
      execute(
        ctx,
        gen(function* () {
          const p1 = signal<string>("p1");
          const p2 = signal<string>("p2");
          const p3 = signal<string>("p3");

          // Equivalent of `p1.map(() => { throw new TerminalError(...) })`:
          // a spawned routine that parks on p1, then throws regardless of
          // whether p1 fulfilled or rejected.
          const p1Throws = yield* spawn(
            gen(function* () {
              try {
                yield* p1;
              } catch {
                // p1 may reject; we throw our own error either way.
              }
              throw new restate.TerminalError("p1 completed");
            })
          );

          try {
            const result = yield* all([race([p1Throws, p2]), race([p1, p3])]);
            // Force a suspension on the success path (not reachable in this
            // test, but keeps the handler shape symmetric).
            yield* sleep({ milliseconds: 1 });
            return result as string[];
          } catch (e) {
            yield* sleep({ milliseconds: 1 });
            throw e;
          }
        })
      ),
  },
});

// ---------------------------------------------------------------------------
// Test suite.
// ---------------------------------------------------------------------------

const modes = [
  { name: "default", alwaysReplay: false },
  { name: "alwaysReplay", alwaysReplay: true },
] as const;

describe.each(modes)(
  "signal-sharing combinators — $name mode",
  ({ alwaysReplay }) => {
    let env: RestateTestEnvironment;
    let ingress: clients.Ingress;

    beforeAll(async () => {
      env = await RestateTestEnvironment.start({
        services: [combinatorSvc, signalSenderSvc],
        alwaysReplay,
      });
      ingress = clients.connect({ url: env.baseUrl() });
    });

    afterAll(async () => {
      await env?.stop();
    });

    const sendSignal = (invocationId: string, name: string, value: string) =>
      ingress
        .serviceClient(signalSenderSvc)
        .resolve({ invocationId, name, value });

    // ---- scenario 1: allSettled(race(p1, p2), race(p1, p3)) ----------------

    test("allSettled — p1 fires first: both races settle with p1's value", async () => {
      const handle = await ingress
        .serviceSendClient(combinatorSvc)
        .allSettledSharedSignal(idem());
      const invocationId = handle.invocationId;

      // p1 fires first — both races should settle with its value.
      await sendSignal(invocationId, "p1", "from-p1");
      // p3 fires afterward — must not disturb the already-settled race.
      await sendSignal(invocationId, "p3", "from-p3");

      const result = await ingress.result(handle);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ status: "fulfilled", value: "from-p1" });
      expect(result[1]).toEqual({ status: "fulfilled", value: "from-p1" });
    }, 30_000);

    test("allSettled — p2 fires first on race1, p3 fires first on race2", async () => {
      const handle = await ingress
        .serviceSendClient(combinatorSvc)
        .allSettledSharedSignal(idem());
      const invocationId = handle.invocationId;

      // p2 wins race1 (p1, p2), p3 wins race2 (p1, p3).
      await sendSignal(invocationId, "p2", "from-p2");
      await sendSignal(invocationId, "p3", "from-p3");
      // p1 fires last — races already settled.
      await sendSignal(invocationId, "p1", "from-p1");

      const result = await ingress.result(handle);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ status: "fulfilled", value: "from-p2" });
      expect(result[1]).toEqual({ status: "fulfilled", value: "from-p3" });
    }, 30_000);

    // ---- scenario 2: all(race(p1→throws, p2), race(p1, p3)) ---------------

    test("all — p1 fires first: spawned transform throws, all rejects", async () => {
      const handle = await ingress
        .serviceSendClient(combinatorSvc)
        .allWithMappedSignal(idem());
      const invocationId = handle.invocationId;

      // p1 fires first — p1Throws routine settles with TerminalError,
      // causing the first race to reject, and all to reject.
      await sendSignal(invocationId, "p1", "from-p1");
      await sendSignal(invocationId, "p3", "from-p3");

      await expect(ingress.result(handle)).rejects.toThrow("p1 completed");
    }, 30_000);

    test("all — p2 fires first on race1: all resolves with both values", async () => {
      const handle = await ingress
        .serviceSendClient(combinatorSvc)
        .allWithMappedSignal(idem());
      const invocationId = handle.invocationId;

      // p2 wins the first race (p1Throws loses), p3 wins the second race.
      await sendSignal(invocationId, "p2", "from-p2");
      await sendSignal(invocationId, "p3", "from-p3");
      // p1 fires last — the races already settled without it.
      await sendSignal(invocationId, "p1", "from-p1");

      const result = await ingress.result(handle);
      expect(result).toHaveLength(2);
      expect(result[0]).toBe("from-p2");
      expect(result[1]).toBe("from-p3");
    }, 30_000);
  }
);
