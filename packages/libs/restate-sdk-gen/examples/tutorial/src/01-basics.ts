// Tier 1: the basics — a single `run`, then chaining, then concurrency.
//
// Maps to guide.md sections "Hello, world", "Sequential work", and
// "Concurrent work". Each handler is a different shape of the same
// underlying primitive (`run` + a combinator). Free-standing API:
// `run`, `all`, `race`, `select` are imported directly — no `ops`
// parameter, no `ctx` plumbing.

import * as restate from "@restatedev/restate-sdk";
import {
  gen,
  execute,
  run,
  all,
  race,
  select,
} from "@restatedev/restate-sdk-gen";
import { fetchA, fetchB, fetchFast, fetchSlow } from "./fakes.js";

export const basics = restate.service({
  name: "basics",
  handlers: {
    // ── 1. Hello world ─────────────────────────────────────────────────
    // One journal entry. The closure runs on first execution; on replay,
    // the recorded value is returned without re-running it.
    hello: async (ctx: restate.Context, name: string): Promise<string> =>
      execute(
        ctx,
        gen(function* () {
          const greeting = yield* run(async () => `Hello, ${name}!`, {
            name: "compose",
          });
          return greeting;
        })
      ),

    // ── 2. Sequential work ────────────────────────────────────────────
    // Two journal entries chained in source order. `b` is started after
    // `a` resolves.
    sequential: async (ctx: restate.Context): Promise<string> =>
      execute(
        ctx,
        gen(function* () {
          const a = yield* run(() => fetchA(), { name: "a" });
          const b = yield* run(() => fetchB(), { name: "b" });
          return `${a}-${b}`;
        })
      ),

    // ── 3. Two pieces of work in parallel ────────────────────────────
    // Both `run` calls return Future<T> immediately; `all` waits for
    // every future to settle, returning values in input order.
    parallel: async (ctx: restate.Context): Promise<string> =>
      execute(
        ctx,
        gen(function* () {
          const aF = run(() => fetchA(), { name: "a" });
          const bF = run(() => fetchB(), { name: "b" });
          const [a, b] = yield* all([aF, bF]);
          return `${a}+${b}`;
        })
      ),

    // ── 4. Whichever finishes first ──────────────────────────────────
    // `race` returns the first value; the loser keeps running in the
    // background and its result is discarded.
    race: async (ctx: restate.Context): Promise<string> =>
      execute(
        ctx,
        gen(function* () {
          return yield* race([
            run(() => fetchFast(), { name: "primary" }),
            run(() => fetchSlow(), { name: "secondary" }),
          ]);
        })
      ),

    // ── 5. Knowing which branch won ──────────────────────────────────
    // `select` is `race` plus a tag. Switch on `r.tag` to know which
    // fired, then unwrap with `yield* r.future` to get the value.
    selectTagged: async (ctx: restate.Context): Promise<string> =>
      execute(
        ctx,
        gen(function* () {
          const r = yield* select({
            fast: run(() => fetchFast(), { name: "fast" }),
            slow: run(() => fetchSlow(), { name: "slow" }),
          });
          switch (r.tag) {
            case "fast":
              return `fast-won: ${yield* r.future}`;
            case "slow":
              return `slow-won: ${yield* r.future}`;
          }
        })
      ),
  },
});
