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

// ---------------------------------------------------------------------------
// Helper: signal-stream reader (same pattern as invocation_streams.ts example)
// ---------------------------------------------------------------------------
class SignalStreamReader<T> implements AsyncIterableIterator<T> {
  constructor(
    private readonly ctx: restate.internal.ContextInternal,
    private readonly name: string
  ) {}

  next(): restate.RestatePromise<IteratorResult<T>> {
    return this.ctx.signal(this.name);
  }

  [Symbol.asyncIterator](): this {
    return this;
  }
}

class SignalStreamWriter<T> {
  constructor(
    private readonly target: restate.internal.InvocationReference,
    private readonly name: string
  ) {}

  append(value: T): void {
    this.target.signal(this.name).resolve({ done: false, value });
  }

  end(): void {
    this.target.signal(this.name).resolve({ done: true });
  }
}

// ---------------------------------------------------------------------------
// Signal test service
// ---------------------------------------------------------------------------
const signalTest = restate.service({
  name: "SignalTest",
  handlers: {
    // ---- Basic signal: wait, resolve, reject ----

    /** Wait for a named signal and return its value. */
    waitForSignal: async (
      ctx: restate.Context,
      name: string
    ): Promise<unknown> => {
      const ctxInternal = ctx as restate.internal.ContextInternal;
      return ctxInternal.signal(name);
    },

    /** Resolve a named signal on a target invocation with an arbitrary value. */
    resolveSignal: async (
      ctx: restate.Context,
      req: { invocationId: string; name: string; value: unknown }
    ): Promise<void> => {
      const ctxInternal = ctx as restate.internal.ContextInternal;
      ctxInternal
        .invocation(restate.InvocationIdParser.fromString(req.invocationId))
        .signal(req.name)
        .resolve(req.value);
    },

    /** Reject a named signal on a target invocation with a reason. */
    rejectSignal: async (
      ctx: restate.Context,
      req: { invocationId: string; name: string; reason: string }
    ): Promise<void> => {
      const ctxInternal = ctx as restate.internal.ContextInternal;
      ctxInternal
        .invocation(restate.InvocationIdParser.fromString(req.invocationId))
        .signal(req.name)
        .reject(req.reason);
    },

    // ---- Multiple named signals ----

    /** Wait for two signals ("signalA" and "signalB") and return both values. */
    waitForTwoSignals: async (
      ctx: restate.Context
    ): Promise<{ a: string; b: string }> => {
      const ctxInternal = ctx as restate.internal.ContextInternal;
      const [a, b] = await restate.RestatePromise.all([
        ctxInternal.signal<string>("signalA"),
        ctxInternal.signal<string>("signalB"),
      ]);
      return { a, b };
    },

    // ---- Race signal against timeout ----

    /** Race "mySignal" against a short timeout. Returns either the signal value or "timeout". */
    raceSignalVsTimeout: async (
      ctx: restate.Context,
      timeoutMs: number
    ): Promise<string> => {
      const ctxInternal = ctx as restate.internal.ContextInternal;
      return ctxInternal
        .signal<string>("mySignal")
        .orTimeout(timeoutMs)
        .map((v, err) => {
          if (err instanceof restate.TimeoutError) {
            return "timeout";
          }
          if (err) {
            throw err;
          }
          return v as string;
        });
    },

    // ---- Signal stream (async iterable) ----

    /** Read from a signal stream until end-of-stream, return collected values. */
    readStream: async (ctx: restate.Context): Promise<string[]> => {
      const ctxInternal = ctx as restate.internal.ContextInternal;
      const reader = new SignalStreamReader<string>(ctxInternal, "stream");
      const values: string[] = [];
      for await (const value of reader) {
        values.push(value);
      }
      return values;
    },

    /** Append values to a target invocation's signal stream. */
    appendToStream: async (
      ctx: restate.Context,
      req: { invocationId: string; values: string[] }
    ): Promise<void> => {
      const ctxInternal = ctx as restate.internal.ContextInternal;
      const target = ctxInternal.invocation(
        restate.InvocationIdParser.fromString(req.invocationId)
      );
      const writer = new SignalStreamWriter<string>(target, "stream");
      for (const value of req.values) {
        writer.append(value);
      }
    },

    /** End a target invocation's signal stream. */
    endStream: async (
      ctx: restate.Context,
      req: { invocationId: string }
    ): Promise<void> => {
      const ctxInternal = ctx as restate.internal.ContextInternal;
      const target = ctxInternal.invocation(
        restate.InvocationIdParser.fromString(req.invocationId)
      );
      new SignalStreamWriter<string>(target, "stream").end();
    },
  },
});

REGISTRY.addService(signalTest);

export type SignalTest = typeof signalTest;
