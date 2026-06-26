// Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
//
// This file is part of the Restate e2e tests,
// which are released under the MIT license.
//
// You can find a copy of the license in file LICENSE in the root
// directory of this repository or package, or at
// https://github.com/restatedev/e2e/blob/main/LICENSE

import * as v8 from "node:v8";
import * as restate from "@restatedev/restate-sdk";
import type { HooksProvider } from "@restatedev/restate-sdk";
import { REGISTRY } from "./services.js";

export interface MemoryLoadInput {
  payloadBytes?: number;
}

export interface RunClosureRetentionInput {
  runCount?: number;
  payloadBytes?: number;
  holdMillis?: number;
}

export interface RunClosureRetentionReleaseInput {
  invocationId?: string;
}

export type RunClosureRetentionPhase =
  | "idle"
  | "capturing"
  | "holding"
  | "released"
  | "completed";

export interface RunClosureRetentionStatus {
  invocationId?: string;
  phase: RunClosureRetentionPhase;
  completedRuns: number;
  runCount: number;
  payloadBytes: number;
}

export interface RunClosureRetentionResult {
  invocationId: string;
  completedRuns: number;
  payloadBytes: number;
}

export interface MemoryStatsInput {
  forceGc?: boolean;
}

export interface MemoryStats {
  gcAvailable: boolean;
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
  totalHeapSize: number;
  usedHeapSize: number;
  heapSizeLimit: number;
}

export interface MemoryInvocationResult {
  invocationId: string;
  payloadBytes: number;
}

function boundedPayloadBytes(input: MemoryLoadInput | undefined): number {
  return Math.max(0, Math.min(input?.payloadBytes ?? 512, 64 * 1024));
}

function boundedRunClosureRetentionPayloadBytes(
  input: RunClosureRetentionInput | undefined
): number {
  return Math.max(0, Math.min(input?.payloadBytes ?? 128 * 1024, 512 * 1024));
}

function boundedRunClosureRetentionRunCount(
  input: RunClosureRetentionInput | undefined
): number {
  return Math.max(1, Math.min(input?.runCount ?? 200, 2_000));
}

function boundedRunClosureRetentionHoldMillis(
  input: RunClosureRetentionInput | undefined
): number {
  return Math.max(1, Math.min(input?.holdMillis ?? 30_000, 120_000));
}

function allocatePayload(input: MemoryLoadInput | undefined): number {
  return "x".repeat(boundedPayloadBytes(input)).length;
}

function allocateRunClosurePayload(
  runIndex: number,
  payloadBytes: number
): number[] {
  const elementCount = Math.max(1, Math.ceil(payloadBytes / 8));
  const payload = new Array<number>(elementCount);

  for (let elementIndex = 0; elementIndex < elementCount; elementIndex++) {
    payload[elementIndex] = runIndex + elementIndex + 0.5;
  }

  return payload;
}

async function completeRunWithCapturedPayload(
  ctx: restate.Context,
  runIndex: number,
  payloadBytes: number
): Promise<number> {
  const capturedPayload = allocateRunClosurePayload(runIndex, payloadBytes);
  return ctx.run(
    `run-closure-retention-captured-payload-${runIndex}`,
    () => capturedPayload.length
  );
}

function forceGcIfAvailable(): boolean {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (!gc) return false;

  gc();
  gc();
  return true;
}

function collectMemoryStats(input: MemoryStatsInput | undefined): MemoryStats {
  const gcAvailable = input?.forceGc === true && forceGcIfAvailable();
  const memory = process.memoryUsage();
  const heap = v8.getHeapStatistics();

  return {
    gcAvailable,
    rss: memory.rss,
    heapTotal: memory.heapTotal,
    heapUsed: memory.heapUsed,
    external: memory.external,
    arrayBuffers: memory.arrayBuffers,
    totalHeapSize: heap.total_heap_size,
    usedHeapSize: heap.used_heap_size,
    heapSizeLimit: heap.heap_size_limit,
  };
}

const passThroughHooks: HooksProvider = () => ({
  interceptor: {
    handler: async (next) => {
      await next();
    },
    run: async (_name, next) => {
      await next();
    },
  },
});

const runClosureRetentionStatus: RunClosureRetentionStatus = {
  phase: "idle",
  completedRuns: 0,
  runCount: 0,
  payloadBytes: 0,
};
let releaseRunClosureRetentionHold: (() => void) | undefined;

function updateRunClosureRetentionStatus(
  update: Partial<RunClosureRetentionStatus>
): RunClosureRetentionStatus {
  Object.assign(runClosureRetentionStatus, update);
  return { ...runClosureRetentionStatus };
}

function waitForRunClosureRetentionRelease(holdMillis: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const timeout = setTimeout(release, holdMillis);

    function release() {
      if (settled) return;

      settled = true;
      clearTimeout(timeout);
      if (releaseRunClosureRetentionHold === release) {
        releaseRunClosureRetentionHold = undefined;
      }
      resolve();
    }

    releaseRunClosureRetentionHold = release;
  });
}

function createMemoryLeakProbe(name: string) {
  return restate.service({
    name,
    handlers: {
      succeed: async (
        ctx: restate.Context,
        input: MemoryLoadInput
      ): Promise<MemoryInvocationResult> => {
        const payloadBytes = await ctx.run("allocate", () =>
          allocatePayload(input)
        );
        return { invocationId: ctx.request().id, payloadBytes };
      },

      terminalError: async (
        ctx: restate.Context,
        input: MemoryLoadInput
      ): Promise<void> => {
        await ctx.run("allocate-before-terminal-error", () =>
          allocatePayload(input)
        );
        throw new restate.TerminalError("memory-leak-terminal-error");
      },

      retryForever: restate.createServiceHandler(
        {
          retryPolicy: {
            initialInterval: 10,
            maxInterval: 50,
            maxAttempts: 10_000,
          },
        },
        async (ctx: restate.Context, input: MemoryLoadInput): Promise<void> => {
          await ctx.run("allocate-before-retry", () => allocatePayload(input));
          throw new Error("memory-leak-retryable-error");
        }
      ),

      pauseAfterMaxAttempts: restate.createServiceHandler(
        {
          retryPolicy: {
            initialInterval: 10,
            maxAttempts: 3,
            onMaxAttempts: "pause",
          },
        },
        async (ctx: restate.Context, input: MemoryLoadInput): Promise<void> => {
          await ctx.run("allocate-before-pause", () => allocatePayload(input));
          throw new Error("memory-leak-pause-after-max-attempts");
        }
      ),

      suspendOnAwakeable: restate.createServiceHandler(
        {
          inactivityTimeout: 250,
        },
        async (
          ctx: restate.Context,
          input: MemoryLoadInput
        ): Promise<MemoryInvocationResult> => {
          const payloadBytes = await ctx.run("allocate-before-suspend", () =>
            allocatePayload(input)
          );
          const { promise } = ctx.awakeable<string>();
          await promise;
          return { invocationId: ctx.request().id, payloadBytes };
        }
      ),

      hookAndRunHook: restate.createServiceHandler(
        {
          hooks: [passThroughHooks],
        },
        async (
          ctx: restate.Context,
          input: MemoryLoadInput
        ): Promise<MemoryInvocationResult> => {
          const payloadBytes = await ctx.run("allocate-with-hooks", () =>
            allocatePayload(input)
          );
          return { invocationId: ctx.request().id, payloadBytes };
        }
      ),

      runClosureRetention: async (
        ctx: restate.Context,
        input: RunClosureRetentionInput
      ): Promise<RunClosureRetentionResult> => {
        const invocationId = ctx.request().id;
        const runCount = boundedRunClosureRetentionRunCount(input);
        const payloadBytes = boundedRunClosureRetentionPayloadBytes(input);
        const holdMillis = boundedRunClosureRetentionHoldMillis(input);

        await ctx.run("run-closure-retention-start", () => {
          releaseRunClosureRetentionHold?.();
          releaseRunClosureRetentionHold = undefined;
          return updateRunClosureRetentionStatus({
            invocationId,
            phase: "capturing",
            completedRuns: 0,
            runCount,
            payloadBytes,
          });
        });

        for (let runIndex = 0; runIndex < runCount; runIndex++) {
          await completeRunWithCapturedPayload(ctx, runIndex, payloadBytes);

          const completedRuns = runIndex + 1;
          if (completedRuns % 25 === 0 || completedRuns === runCount) {
            await ctx.run(
              `run-closure-retention-progress-${completedRuns}`,
              () =>
                updateRunClosureRetentionStatus({
                  completedRuns,
                })
            );
          }
        }

        await ctx.run("run-closure-retention-holding", () =>
          updateRunClosureRetentionStatus({
            phase: "holding",
          })
        );
        await ctx.run("run-closure-retention-hold", () =>
          waitForRunClosureRetentionRelease(holdMillis)
        );
        await ctx.run("run-closure-retention-completed", () =>
          updateRunClosureRetentionStatus({
            phase: "completed",
            completedRuns: runCount,
          })
        );

        return { invocationId, completedRuns: runCount, payloadBytes };
      },

      runClosureRetentionStatus: async (
        ctx: restate.Context
      ): Promise<RunClosureRetentionStatus> => {
        return ctx.run("run-closure-retention-status", () => ({
          ...runClosureRetentionStatus,
        }));
      },

      releaseRunClosureRetention: async (
        ctx: restate.Context,
        input: RunClosureRetentionReleaseInput
      ): Promise<boolean> => {
        return ctx.run("release-run-closure-retention", () => {
          if (
            input?.invocationId !== undefined &&
            input.invocationId !== runClosureRetentionStatus.invocationId
          ) {
            return false;
          }

          const release = releaseRunClosureRetentionHold;
          if (release === undefined) return false;

          releaseRunClosureRetentionHold = undefined;
          updateRunClosureRetentionStatus({ phase: "released" });
          release();
          return true;
        });
      },

      abortTimeoutZero: restate.createServiceHandler(
        {
          inactivityTimeout: 0,
          abortTimeout: 0,
          retryPolicy: {
            initialInterval: 10,
            maxAttempts: 1,
            onMaxAttempts: "kill",
          },
        },
        async (ctx: restate.Context, input: MemoryLoadInput): Promise<void> => {
          await ctx.run("wait-for-zero-abort-timeout", async () => {
            allocatePayload(input);
            const signal = ctx.request().attemptCompletedSignal;
            await new Promise<void>((_resolve, reject) => {
              if (signal.aborted) {
                reject(new Error("aborted"));
                return;
              }
              signal.addEventListener(
                "abort",
                () => reject(new Error("aborted")),
                { once: true }
              );
            });
          });
        }
      ),

      memoryStats: async (
        ctx: restate.Context,
        input: MemoryStatsInput
      ): Promise<MemoryStats> => {
        return ctx.run("memory-stats", () => collectMemoryStats(input));
      },
    },
  });
}

export const memoryLeakProbe = createMemoryLeakProbe("MemoryLeakProbe");

export type MemoryLeakProbe = typeof memoryLeakProbe;

REGISTRY.addService(memoryLeakProbe);
