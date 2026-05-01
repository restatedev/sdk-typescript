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
  type InvocationStatusReportRow,
  type MemoryLeakSendClient,
  type MemoryProbeConfig,
  type MemoryReportRow,
} from "./memory_leak_utils.js";
import { getAdminUrl, getIngressUrl } from "./utils.js";

const testTimeout = envInt("RESTATE_E2E_MEMORY_TEST_TIMEOUT_MS", 180_000);
const invocationStatusSendMethods = {
  succeeded: "succeed",
  failed: "terminalError",
  retrying: "retryForever",
  suspended: "suspendOnAwakeable",
  paused: "pauseAfterMaxAttempts",
} as const satisfies Record<string, keyof MemoryLeakSendClient>;

type InvocationGroups = Record<
  keyof typeof invocationStatusSendMethods,
  string[]
>;

describe("SDK memory pressure", { timeout: testTimeout }, () => {
  it("does not retain SDK heap after mixed invocation status load", async () => {
    const ingress = clients.connect({ url: getIngressUrl() });
    const adminUrl = getAdminUrl();
    const config: MemoryProbeConfig = {
      payloadBytes: envInt("RESTATE_E2E_MEMORY_PAYLOAD_BYTES", 512),
      waitTimeout: envInt("RESTATE_E2E_MEMORY_WAIT_TIMEOUT_MS", 90_000),
      cleanupDelay: envInt("RESTATE_E2E_MEMORY_CLEANUP_DELAY_MS", 1_000),
      invocationsPerInvocationStatusPerRound: envInt(
        "RESTATE_E2E_MEMORY_INVOCATIONS_PER_INVOCATION_STATUS_PER_ROUND",
        25
      ),
      warmupInvocationsPerInvocationStatus: envInt(
        "RESTATE_E2E_MEMORY_WARMUP_INVOCATIONS_PER_INVOCATION_STATUS",
        5
      ),
      rounds: envInt("RESTATE_E2E_MEMORY_ROUNDS", 4),
      maxHeapDeltaBytes: envInt(
        "RESTATE_E2E_MEMORY_MAX_HEAP_DELTA_BYTES",
        8 * 1024 * 1024
      ),
    };
    const invocationStatusCount = Object.keys(
      invocationStatusSendMethods
    ).length;

    const client = ingress.serviceClient(memoryLeakProbe);
    const sendClient = ingress.serviceSendClient(
      memoryLeakProbe
    ) as unknown as MemoryLeakSendClient;

    const invocationStatusRows: InvocationStatusReportRow[] = [];
    const roundMemoryRows: MemoryReportRow[] = [];
    let measuredInvocations = 0;
    let baseline = await client.memoryStats({ forceGc: true });
    let latestAfterCleanup = baseline;
    let previousAfterCleanup = baseline;
    const iterations = [
      {
        round: "warmup" as const,
        invocationsPerStatus: config.warmupInvocationsPerInvocationStatus,
      },
      ...Array.from({ length: config.rounds }, (_, index) => ({
        round: index + 1,
        invocationsPerStatus: config.invocationsPerInvocationStatusPerRound,
      })),
    ];

    for (const iteration of iterations) {
      const groups = Object.fromEntries(
        await Promise.all(
          Object.entries(invocationStatusSendMethods).map(
            async ([status, method]) => [
              status,
              await Promise.all(
                Array.from(
                  {
                    length: iteration.invocationsPerStatus,
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
          succeeded: iteration.invocationsPerStatus,
          failed: iteration.invocationsPerStatus,
          retrying: iteration.invocationsPerStatus,
          suspended: iteration.invocationsPerStatus,
          paused: iteration.invocationsPerStatus,
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
      const actualRoundInvocations =
        iteration.invocationsPerStatus * invocationStatusCount;

      measuredInvocations += actualRoundInvocations;
      latestAfterCleanup = completedRoundHeap;
      previousAfterCleanup = completedRoundHeap;

      invocationStatusRows.push({
        round: iteration.round,
        succeeded: iteration.invocationsPerStatus,
        failed: iteration.invocationsPerStatus,
        retrying: iteration.invocationsPerStatus,
        suspended: iteration.invocationsPerStatus,
        paused: iteration.invocationsPerStatus,
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
      invocationStatusRows,
      roundMemoryRows,
    });

    console.log(`\n${report}`);

    if (exceededThreshold) {
      expect.fail(report);
    }
  });
});
