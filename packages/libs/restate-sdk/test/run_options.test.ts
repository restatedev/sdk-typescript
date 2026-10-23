/*
 * Copyright (c) 2026 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { InvocationIdParser } from "../src/context.js";
import { ContextImpl } from "../src/context_impl.js";
import {
  LogLevel,
  WasmHeader,
  WasmJournalMismatchBehavior,
  WasmVM,
} from "../src/endpoint/handlers/vm/sdk_shared_core_wasm_bindings.js";
import { HandlerKind } from "../src/types/rpc.js";
import { RetryableError } from "../src/types/errors.js";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }
  vi.restoreAllMocks();
});

function createContext() {
  const coreVm = new WasmVM(
    [new WasmHeader("content-type", "application/vnd.restate.invocation.v5")],
    LogLevel.ERROR,
    0,
    false,
    false,
    WasmJournalMismatchBehavior.Retry,
    false
  );
  const input = Promise.withResolvers<IteratorResult<Uint8Array>>();
  const ctx = new ContextImpl(
    coreVm,
    {
      free: () => {},
      [Symbol.dispose]: () => {},
      headers: [],
      idempotency_key: undefined,
      input: new Uint8Array(),
      invocation_id: "test-invocation",
      key: "",
      limit_key: undefined,
      random_seed: 0n,
      scope: undefined,
    },
    console,
    HandlerKind.SERVICE,
    console,
    {
      target: {
        service: "test-service",
        handler: "test-handler",
        toString: () => "test-service/test-handler",
      },
      id: InvocationIdParser.fromString("inv-test"),
      headers: new Map(),
      attemptHeaders: new Map(),
      body: new Uint8Array(),
      extraArgs: [],
      attemptCompletedSignal: new AbortController().signal,
    },
    Promise.withResolvers<void>(),
    { next: () => input.promise },
    { write: () => Promise.resolve(), close: () => Promise.resolve() },
    { encode: (value) => value, decode: (value) => Promise.resolve(value) }
  );
  cleanups.push(async () => {
    input.resolve({ done: true, value: undefined });
    await ctx.inputPump.stop();
    coreVm.free();
  });
  const sysRun = vi
    .spyOn(coreVm, "sys_run")
    .mockReturnValue({ replayed: true, handle: 1 });
  vi.spyOn(coreVm, "last_command_index").mockReturnValue(1);
  return { ctx, sysRun };
}

describe("ctx.run maxRetryAttempts", () => {
  it.each([
    -1,
    -0.5,
    1.5,
    NaN,
    Infinity,
    -Infinity,
    4_294_967_296,
    Number.MAX_SAFE_INTEGER,
  ])(
    "rejects %s before journaling or running the action",
    (maxRetryAttempts) => {
      for (const error of [new Error("boom"), new RetryableError("boom")]) {
        const { ctx, sysRun } = createContext();
        const action = vi.fn(() => {
          throw error;
        });
        const run = () => ctx.run("step", action, { maxRetryAttempts });
        expect(run).toThrow(RangeError);
        expect(run).toThrow(/maxRetryAttempts.*integer.*0.*4294967295/);
        expect(sysRun).not.toHaveBeenCalled();
        expect(action).not.toHaveBeenCalled();
      }
    }
  );

  it.each([undefined, 0, 1, 5, 4_294_967_295])(
    "accepts %s on a replayed run",
    (maxRetryAttempts) => {
      const { ctx, sysRun } = createContext();
      const action = vi.fn(() => "result");
      expect(() => ctx.run("step", action, { maxRetryAttempts })).not.toThrow();
      expect(sysRun).toHaveBeenCalledWith("step");
      expect(action).not.toHaveBeenCalled();
    }
  );
});
