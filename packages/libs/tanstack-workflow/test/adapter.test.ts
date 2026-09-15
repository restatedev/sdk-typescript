/*
 * Copyright (c) 2023-2025 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ObjectContext } from "@restatedev/restate-sdk/lite/fetch";
import { runHandler } from "../src/adapter.js";
import { charges, checkout, receipts } from "./fixtures/checkout.js";

/**
 * Minimal in-memory stand-in for a Restate ObjectContext. `run` executes the
 * step body immediately (no journaling) and `awakeable` resolves with a
 * caller-provided value, so the approval path can be exercised synchronously.
 */
function mockCtx(opts: {
  key: string;
  approval?: { approved: boolean; feedback?: string };
}) {
  const state = new Map<string, unknown>();
  const runCalls: string[] = [];
  const ctx = {
    key: opts.key,
    run: vi.fn((name: string, fn: () => unknown) => {
      runCalls.push(name);
      return Promise.resolve(fn());
    }),
    sleep: vi.fn(async () => {}),
    date: { now: vi.fn(async () => 1_700_000_000_000) },
    rand: { uuidv4: vi.fn(() => "uuid-fixed"), random: () => 0.5 },
    set: vi.fn((k: string, v: unknown) => state.set(k, v)),
    get: vi.fn(async (k: string) => state.get(k) ?? null),
    clear: vi.fn((k: string) => state.delete(k)),
    awakeable: vi.fn(() => ({
      id: "awk-1",
      promise: Promise.resolve(opts.approval ?? { approved: true }),
    })),
    resolveAwakeable: vi.fn(),
    console,
  };
  return { ctx: ctx as unknown as ObjectContext, runCalls, state, spies: ctx };
}

describe("restate tanstack-workflow adapter", () => {
  beforeEach(() => {
    charges.length = 0;
    receipts.length = 0;
  });

  it("runs the no-approval path, mapping ctx.step to ctx.run", async () => {
    const { ctx, runCalls } = mockCtx({ key: "run1" });
    const output = await runHandler(checkout, ctx, {
      userId: "cus_123",
      amount: 4200,
    });
    expect(output).toEqual({ status: "approved" });
    // Both steps became Restate journal entries, and no approval was requested.
    expect(runCalls).toEqual(["charge-card", "send-receipt"]);
  });

  it("derives a deterministic step id for external idempotency", async () => {
    const { ctx } = mockCtx({ key: "run1" });
    await runHandler(checkout, ctx, { userId: "cus_123", amount: 4200 });
    expect(charges).toEqual([
      { customer: "cus_123", idempotencyKey: "run1:charge-card" },
    ]);
  });

  it("runs the approval path via an awakeable", async () => {
    const { ctx, runCalls, spies } = mockCtx({
      key: "run2",
      approval: { approved: true },
    });
    const output = await runHandler(checkout, ctx, {
      userId: "cus_123",
      amount: 20_000,
    });
    expect(output).toEqual({ status: "approved" });
    expect(runCalls).toContain("charge-card");
    // An awakeable was created and its id parked in object state under the
    // deterministic approvalId, then cleared once resolved.
    expect(spies.awakeable).toHaveBeenCalled();
    expect(spies.set).toHaveBeenCalledWith("approval:uuid-fixed", "awk-1");
    expect(spies.clear).toHaveBeenCalledWith("approval:uuid-fixed");
  });

  it("rejects when the approver denies the charge", async () => {
    const { ctx } = mockCtx({ key: "run3", approval: { approved: false } });
    const output = await runHandler(checkout, ctx, {
      userId: "cus_123",
      amount: 20_000,
    });
    expect(output).toEqual({ status: "rejected" });
    // The receipt step must not run on the rejected branch.
    expect(receipts).toEqual([]);
  });

  it("validates input via the workflow schema", async () => {
    const { ctx } = mockCtx({ key: "run4" });
    await expect(
      runHandler(checkout, ctx, { userId: "cus_123" })
    ).rejects.toThrow(/input validation failed/);
  });
});
