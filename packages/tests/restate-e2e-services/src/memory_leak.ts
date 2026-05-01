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
import { REGISTRY } from "./services.js";

export interface MemoryLoadInput {
  payloadBytes?: number;
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

function allocatePayload(input: MemoryLoadInput | undefined): number {
  return "x".repeat(boundedPayloadBytes(input)).length;
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
