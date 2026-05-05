// Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
//
// This file is part of the Restate e2e tests,
// which is released under the MIT license.
//
// You can find a copy of the license in file LICENSE in the root
// directory of this repository or package, or at
// https://github.com/restatedev/e2e/blob/main/LICENSE

import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import * as clients from "@restatedev/restate-sdk-clients";
import { memoryLeakProbe } from "../src/memory_leak.js";
import {
  envInt,
  invocationStatusCounts,
  renderMemoryLeakReport,
  type InvocationLoadReportRow,
  type MemoryLeakSendClient,
  type MemoryProbeConfig,
  type MemoryReportRow,
} from "./memory_leak_utils.js";
import { getAdminUrl, getIngressUrl } from "./utils.js";

const testTimeout = envInt("RESTATE_E2E_MEMORY_TEST_TIMEOUT_MS", 360_000);
const invocationLoadSendMethods = {
  succeeded: "succeed",
  failed: "terminalError",
  retrying: "retryForever",
  suspended: "suspendOnAwakeable",
  paused: "pauseAfterMaxAttempts",
  hookAndRunHook: "hookAndRunHook",
  abortTimeoutZero: "abortTimeoutZero",
} as const satisfies Record<string, keyof MemoryLeakSendClient>;

type InvocationGroups = Record<
  keyof typeof invocationLoadSendMethods,
  string[]
>;

describe("SDK memory pressure", { timeout: testTimeout }, () => {
  it("does not retain SDK heap after mixed invocation load", async () => {
    const ingress = clients.connect({ url: getIngressUrl() });
    const adminUrl = getAdminUrl();
    const config: MemoryProbeConfig = {
      payloadBytes: envInt("RESTATE_E2E_MEMORY_PAYLOAD_BYTES", 512),
      waitTimeout: envInt("RESTATE_E2E_MEMORY_WAIT_TIMEOUT_MS", 90_000),
      cleanupDelay: envInt("RESTATE_E2E_MEMORY_CLEANUP_DELAY_MS", 1_000),
      invocationsPerHandlerPerRound: envInt(
        "RESTATE_E2E_MEMORY_INVOCATIONS_PER_HANDLER_PER_ROUND",
        25
      ),
      rounds: envInt("RESTATE_E2E_MEMORY_ROUNDS", 20),
      maxHeapDeltaBytes: envInt(
        "RESTATE_E2E_MEMORY_MAX_HEAP_DELTA_BYTES",
        8 * 1024 * 1024
      ),
    };
    const client = ingress.serviceClient(memoryLeakProbe);
    const sendClient = ingress.serviceSendClient(
      memoryLeakProbe
    ) as unknown as MemoryLeakSendClient;

    const invocationLoadRows: InvocationLoadReportRow[] = [];
    const roundMemoryRows: MemoryReportRow[] = [];
    let measuredInvocations = 0;
    let baseline = await client.memoryStats({ forceGc: true });
    let latestAfterCleanup = baseline;
    let previousAfterCleanup = baseline;
    const iterations = [
      {
        round: "warmup" as const,
        invocationsPerHandler: config.invocationsPerHandlerPerRound,
      },
      ...Array.from({ length: config.rounds }, (_, index) => ({
        round: index + 1,
        invocationsPerHandler: config.invocationsPerHandlerPerRound,
      })),
    ];

    for (const iteration of iterations) {
      const groups = Object.fromEntries(
        await Promise.all(
          Object.entries(invocationLoadSendMethods).map(
            async ([status, method]) => [
              status,
              await Promise.all(
                Array.from(
                  {
                    length: iteration.invocationsPerHandler,
                  },
                  () =>
                    sendClient[method]({
                      payloadBytes: config.payloadBytes,
                    }).then(({ invocationId }) => invocationId)
                )
              ),
            ]
          )
        )
      ) as InvocationGroups;

      await expect
        .poll(
          async () =>
            invocationStatusCounts(adminUrl, Object.values(groups).flat()),
          { timeout: config.waitTimeout, interval: 500 }
        )
        .toMatchObject({
          succeeded: groups.succeeded.length + groups.hookAndRunHook.length,
          failed: groups.failed.length + groups.abortTimeoutZero.length,
          retrying: groups.retrying.length,
          suspended: groups.suspended.length,
          paused: groups.paused.length,
        });

      const underLoad =
        iteration.round === "warmup"
          ? undefined
          : await client.memoryStats({ forceGc: true });
      await Promise.all(
        [...groups.retrying, ...groups.suspended, ...groups.paused].map(
          async (invocationId) => {
            const res = await fetch(
              `${adminUrl}/invocations/${invocationId}/kill`,
              {
                method: "PATCH",
                headers: { Accept: "application/json" },
              }
            );

            if (!res.ok && res.status !== 404) {
              throw new Error(
                `Kill ${invocationId} failed: ${res.status} ${await res.text()}`
              );
            }
          }
        )
      );
      await delay(config.cleanupDelay);

      const completedRoundHeap = await client.memoryStats({ forceGc: true });
      if (iteration.round === "warmup") {
        baseline = completedRoundHeap;
        expect(
          baseline.gcAvailable,
          "MemoryLeakProbe must run under node --expose-gc"
        ).toBe(true);
        latestAfterCleanup = baseline;
        previousAfterCleanup = baseline;
        roundMemoryRows.push({
          round: "baseline",
          invocations: 0,
          heapAfterGc: baseline.heapUsed,
          deltaFromBaseline: 0,
        });
        continue;
      }

      const heapDeltaSincePreviousRound =
        completedRoundHeap.heapUsed - previousAfterCleanup.heapUsed;
      const heapDeltaSinceBaseline =
        completedRoundHeap.heapUsed - baseline.heapUsed;
      const actualRoundInvocations = Object.values(groups).flat().length;

      measuredInvocations += actualRoundInvocations;
      latestAfterCleanup = completedRoundHeap;
      previousAfterCleanup = completedRoundHeap;

      invocationLoadRows.push({
        round: iteration.round,
        succeeded: groups.succeeded.length,
        failed: groups.failed.length,
        retrying: groups.retrying.length,
        suspended: groups.suspended.length,
        paused: groups.paused.length,
        hookAndRunHook: groups.hookAndRunHook.length,
        abortTimeoutZero: groups.abortTimeoutZero.length,
      });
      roundMemoryRows.push({
        round: iteration.round,
        invocations: actualRoundInvocations,
        heapAfterGc: completedRoundHeap.heapUsed,
        deltaFromPrevious: heapDeltaSincePreviousRound,
        deltaFromBaseline: heapDeltaSinceBaseline,
        heapBeforeCleanup: underLoad?.heapUsed,
      });
    }

    const totalHeapDelta = latestAfterCleanup.heapUsed - baseline.heapUsed;
    const retainedHeapDelta = Math.max(0, totalHeapDelta);
    const exceededThreshold = retainedHeapDelta > config.maxHeapDeltaBytes;
    const report = renderMemoryLeakReport({
      exceededThreshold,
      measuredInvocations,
      baselineHeapUsed: baseline.heapUsed,
      finalHeapUsed: latestAfterCleanup.heapUsed,
      totalHeapDelta,
      maxHeapDeltaBytes: config.maxHeapDeltaBytes,
      invocationLoadRows,
      roundMemoryRows,
    });

    console.log(`\n${report}`);

    if (exceededThreshold) {
      expect.fail(report);
    }
  });
});
