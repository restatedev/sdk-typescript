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
import {setTimeout} from "node:timers/promises"

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

    // --- Async map on ConstRestatePromise ---

    resolveAsyncMap: async (
      _ctx: restate.Context,
      value: string
    ): Promise<string> => {
      // async mapper on a resolved const promise
      return RestatePromise.resolve(value).map(async (v) => {
        return `mapped:${v ?? ""}`;
      });
    },

    rejectAsyncMapRecover: async (
      _ctx: restate.Context,
      message: string
    ): Promise<string> => {
      // async mapper recovers from a rejected const promise
      return RestatePromise.reject<string>(
        new restate.TerminalError(message)
      ).map(async (_v, err) => {
        return `recovered:${err?.message ?? ""}`;
      });
    },

    resolveAsyncMapChained: async (
      _ctx: restate.Context,
      value: string
    ): Promise<string> => {
      // chained async maps on a resolved const promise
      return RestatePromise.resolve(value)
        .map(async (v) => `${v ?? ""}-a`)
        .map(async (v) => `${v ?? ""}-b`)
        .map(async (v) => `${v ?? ""}-c`);
    },

    resolveAsyncMapWithCtxRun: async (
      ctx: restate.Context,
      value: string
    ): Promise<string> => {
      // async mapper that performs a ctx.run inside — verifies determinism:
      // the ctx.run must be journaled exactly once across replays even though
      // the mapper is a microtask-deferred async closure.
      return RestatePromise.resolve(value).map(async (v) => {
        const suffix = await ctx.run("append", () => "ran");
        return `${v ?? ""}-${suffix}`;
      });
    },

    resolveAsyncMapThrows: async (
      _ctx: restate.Context,
      input: { value: string; errorMessage: string }
    ): Promise<string> => {
      // async mapper throws TerminalError — must propagate as rejection
      return RestatePromise.resolve(input.value).map(async () => {
        throw new restate.TerminalError(input.errorMessage);
      });
    },

    resolveAsyncMapOrTimeout: async (
      _ctx: restate.Context,
      value: string
    ): Promise<string> => {
      // resolve().map(async).orTimeout() — mapped promise inherits settled=true,
      // so orTimeout returns `this` and the async mapper still runs to completion.
      return RestatePromise.resolve(value)
        .map(async (v) => `mapped:${v ?? ""}`)
        .orTimeout(1);
    },

    allSettledAsyncMapWithCtxRun: async (
      ctx: restate.Context,
      values: string[]
    ): Promise<string[]> => {
      // Build N const RestatePromises, each with an async mapper that calls ctx.run,
      // then await them together via RestatePromise.allSettled.
      // Verifies: (a) mappers fire lazily (only when allSettled consumes them),
      // (b) each ctx.run is journaled deterministically, (c) results come back in order.
      const promises = values.map((v, i) =>
        RestatePromise.resolve(v).map(async (inner) => {
          const suffix = await ctx.run(`run-${i}`, async () => {
           await setTimeout(Math.random() *1000)
           return `ran-${i}`;
          });
          return `${inner ?? ""}:${suffix}`;
        })
      );
      return RestatePromise.all(promises);
    },
  },
});

const { RestatePromise } = restate;

REGISTRY.addService(promiseCombinators);

export type PromiseCombinators = typeof promiseCombinators;
