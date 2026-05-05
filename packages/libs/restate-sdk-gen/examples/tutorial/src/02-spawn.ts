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

// Tier 2: spawning concurrent routines + combinators over them.
//
// Maps to guide.md §"Spawning concurrent routines". Use spawn when each
// concurrent unit is itself a multi-step Operation with internal logic.
//
// Headline feature: a spawned routine yields a `Future<T>` — the same
// shape `run` returns. Every combinator (all, race, any, allSettled,
// select) works identically over journal-backed and routine-backed
// futures, and you can mix the two in a single combinator. The
// scheduler picks an optimal implementation behind the scenes; user
// code doesn't change.

import * as restate from "@restatedev/restate-sdk";
import {
  gen,
  execute,
  spawn,
  run,
  all,
  race,
  select,
  type Operation,
} from "@restatedev/restate-sdk-gen";
import { wait } from "./fakes.js";

// Tiny sub-workflow factory used across the handlers below: do some
// journaled work for `ms` milliseconds, return `label`. Each call
// produces a fresh Operation with its own internal `run` entry.
const labeledWork = (label: string, ms: number): Operation<string> =>
  gen(function* () {
    return yield* run(
      async () => {
        await wait(ms);
        return label;
      },
      { name: `${label}-step` }
    );
  });

export const spawnSvc = restate.service({
  name: "spawn",
  handlers: {
    // 2.1 spawn-and-await — the basic shape.
    // Concurrency starts at the spawn (the work is already running by
    // the time `yield* spawn(...)` resumes); the later `yield* tX` is
    // just a collection point.
    twoRoutines: async (ctx: restate.Context): Promise<string> =>
      execute(
        ctx,
        gen(function* () {
          const tA = yield* spawn(labeledWork("A", 50));
          const tB = yield* spawn(labeledWork("B", 60));
          return `${yield* tA}|${yield* tB}`;
        })
      ),

    // 2.2 fan-out + fan-in via `all` over spawned futures.
    // Same call site as all over journal entries; the scheduler
    // doesn't care which backing each future has.
    allSpawned: async (ctx: restate.Context): Promise<string[]> =>
      execute(
        ctx,
        gen(function* () {
          const labels = ["X", "Y", "Z"];
          const tasks = [];
          for (const l of labels) {
            tasks.push(yield* spawn(labeledWork(l, 40 + l.length)));
          }
          return yield* all(tasks); // ["X","Y","Z"], in input order
        })
      ),

    // 2.3 race over spawned futures: first to settle wins.
    // The losing routine keeps running in the background; its result
    // is journaled but no one reads it. Use this for hedged calls or
    // fastest-replica-wins patterns.
    raceSpawned: async (ctx: restate.Context): Promise<string> =>
      execute(
        ctx,
        gen(function* () {
          const fast = yield* spawn(labeledWork("fast", 30));
          const slow = yield* spawn(labeledWork("slow", 200));
          return yield* race([fast, slow]);
        })
      ),

    // 2.4 select over spawned futures: race + tag.
    // Branch on which side won, unwrap with yield* r.future.
    selectSpawned: async (ctx: restate.Context): Promise<string> =>
      execute(
        ctx,
        gen(function* () {
          const a = yield* spawn(labeledWork("alpha", 30));
          const b = yield* spawn(labeledWork("beta", 200));
          const r = yield* select({ a, b });
          return `${r.tag}-won:${yield* r.future}`;
        })
      ),

    // 2.5 mixed sources: a single combinator over a mix of journal-
    // backed and routine-backed futures. They're indistinguishable
    // at the combinator boundary — that's the point of unifying both
    // backings under Future<T>.
    mixedSources: async (ctx: restate.Context): Promise<string> =>
      execute(
        ctx,
        gen(function* () {
          const journal = run(
            async () => {
              await wait(50);
              return "from-run";
            },
            { name: "journaled" }
          );
          const routine = yield* spawn(labeledWork("from-spawn", 30));
          const [a, b] = yield* all([journal, routine]);
          return `${a} + ${b}`;
        })
      ),

    // 2.6 recursive spawn: divide-and-conquer.
    // Each branch becomes a fresh routine; all joins the children.
    fibonacci: async (ctx: restate.Context, n: number): Promise<number> => {
      const fib = (k: number): Operation<number> =>
        gen(function* () {
          if (k < 2) return k;
          const a = yield* spawn(fib(k - 1));
          const b = yield* spawn(fib(k - 2));
          const vs = yield* all([a, b]);
          return vs.reduce((x, y) => x + y, 0);
        });
      return execute(ctx, fib(n));
    },
  },
});
