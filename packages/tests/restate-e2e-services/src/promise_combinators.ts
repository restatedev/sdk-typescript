// Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
//
// This file is part of the Restate e2e tests,
// which are released under the MIT license.
//
// You can find a copy of the license in file LICENSE in the root
// directory of this repository or package, or at
// https://github.com/restatedev/e2e/blob/main/LICENSE

import * as restate from "@restatedev/restate-sdk";
import { REGISTRY } from "./services.js";

const promiseCombinators = restate.service({
  name: "PromiseCombinators",
  handlers: {
    // --- RestatePromise.resolve / reject ---

    resolveWithValue: async (
      _ctx: restate.Context,
      value: string
    ): Promise<string> => {
      return RestatePromise.resolve(value);
    },

    rejectWithTerminalError: async (
      _ctx: restate.Context,
      message: string
    ): Promise<string> => {
      return RestatePromise.reject(new restate.TerminalError(message));
    },

    // --- Combinators with RestatePromise.resolve/reject ---

    allWithResolvedPromises: async (
      _ctx: restate.Context,
      values: string[]
    ): Promise<string[]> => {
      const promises = values.map((v) => RestatePromise.resolve(v));
      return RestatePromise.all(promises);
    },

    allWithOneRejected: async (
      _ctx: restate.Context,
      input: { values: string[]; rejectIndex: number; errorMessage: string }
    ): Promise<string[]> => {
      const promises = input.values.map((v, i) =>
        i === input.rejectIndex
          ? RestatePromise.reject<string>(
              new restate.TerminalError(input.errorMessage)
            )
          : RestatePromise.resolve(v)
      );
      return RestatePromise.all(promises);
    },

    raceWithResolvedPromises: async (
      _ctx: restate.Context,
      values: string[]
    ): Promise<string> => {
      const promises = values.map((v) => RestatePromise.resolve(v));
      return RestatePromise.race(promises);
    },

    anyWithResolvedPromises: async (
      _ctx: restate.Context,
      values: string[]
    ): Promise<string> => {
      const promises = values.map((v) => RestatePromise.resolve(v));
      return RestatePromise.any(promises);
    },

    anyWithAllRejected: async (
      _ctx: restate.Context,
      messages: string[]
    ): Promise<string> => {
      const promises = messages.map((m) =>
        RestatePromise.reject<string>(new restate.TerminalError(m))
      );
      return RestatePromise.any(promises);
    },

    allSettledMixed: async (
      _ctx: restate.Context,
      input: { values: string[]; rejectIndices: number[] }
    ): Promise<PromiseSettledResult<string>[]> => {
      const rejectSet = new Set(input.rejectIndices);
      const promises = input.values.map((v, i) =>
        rejectSet.has(i)
          ? RestatePromise.reject<string>(new restate.TerminalError(v))
          : RestatePromise.resolve(v)
      );
      return RestatePromise.allSettled(promises);
    },

    // --- Empty array combinators ---

    allEmpty: async (_ctx: restate.Context): Promise<unknown[]> => {
      return RestatePromise.all([]);
    },

    allSettledEmpty: async (
      _ctx: restate.Context
    ): Promise<PromiseSettledResult<unknown>[]> => {
      return RestatePromise.allSettled([]);
    },

    // --- Mixed: context promises + resolved/rejected ---

    allMixedWithSleep: async (
      ctx: restate.Context,
      input: { sleepMs: number; resolvedValue: string }
    ): Promise<[string, string]> => {
      const sleepPromise = ctx
        .sleep(input.sleepMs)
        .map(() => "slept" as string);
      const resolvedPromise = RestatePromise.resolve(input.resolvedValue);
      return RestatePromise.all([sleepPromise, resolvedPromise]);
    },

    raceMixedWithSleep: async (
      ctx: restate.Context,
      input: { sleepMs: number; resolvedValue: string }
    ): Promise<string> => {
      const sleepPromise = ctx
        .sleep(input.sleepMs)
        .map(() => "slept" as string);
      const resolvedPromise = RestatePromise.resolve(input.resolvedValue);
      return RestatePromise.race([sleepPromise, resolvedPromise]);
    },

    // --- orTimeout on resolved/pending ---

    resolveOrTimeout: async (
      _ctx: restate.Context,
      value: string
    ): Promise<string> => {
      // orTimeout on an already-resolved promise should return the value, not timeout
      return RestatePromise.resolve(value).orTimeout(1);
    },

    raceEmptyOrTimeout: async (_ctx: restate.Context): Promise<string> => {
      // race([]) is forever pending, orTimeout should reject with TimeoutError
      return RestatePromise.race<restate.RestatePromise<string>[]>(
        []
      ).orTimeout(1);
    },

    raceEmptyOrTimeoutMapped: async (
      _ctx: restate.Context
    ): Promise<string> => {
      // race([]).orTimeout().map() — verify we can map the TimeoutError
      return RestatePromise.race<restate.RestatePromise<string>[]>([])
        .orTimeout(1)
        .map((_v, err) => {
          if (err instanceof restate.TimeoutError) {
            return "timeout";
          }
          return "unexpected";
        });
    },

    verifyConstPromiseMapDeterministic: restate.handlers.handler(
      {
        inactivityTimeout: 0,
      },
      async (ctx: restate.Context, value: string): Promise<string> => {
        // 1. Contract: the mapper runs ONLY when the RestatePromise is
        //    awaited, never eagerly when `.map()` is called.
        // 2. If violated: the mapper's `ctx.rand.uuidv4()` lands BETWEEN
        //    the two outer `ctx.rand.uuidv4()` calls below (at .map() time).
        // 3. If held: it lands AFTER both, when `mappedPromise` is awaited.
        // 4. The two interleavings observe different RNG state, so the uuid
        //    produced inside the mapper differs.
        // 5. We feed that uuid as the journaled name of a `ctx.sleep`. Names
        //    are checked for equality on replay; a mismatch fails the
        //    invocation.
        // 6. inactivityTimeout: 0 forces suspension at every journal entry,
        //    so any divergence fails fast on the very next replay.

        ctx.rand.uuidv4();
        const mappedPromise = RestatePromise.resolve(undefined).map(() =>
          ctx.rand.uuidv4()
        );
        ctx.rand.uuidv4();

        await ctx.sleep({ milliseconds: 50 });
        const shouldBeDeterministic = await mappedPromise;

        await ctx.sleep({ milliseconds: 50 }, shouldBeDeterministic);

        return value;
      }
    ),
  },
});

const { RestatePromise } = restate;

REGISTRY.addService(promiseCombinators);

export type PromiseCombinators = typeof promiseCombinators;
