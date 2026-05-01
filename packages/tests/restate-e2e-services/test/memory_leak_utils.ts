// Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
//
// This file is part of the Restate e2e tests,
// which is released under the MIT license.
//
// You can find a copy of the license in file LICENSE in the root
// directory of this repository or package, or at
// https://github.com/restatedev/e2e/blob/main/LICENSE

import type * as clients from "@restatedev/restate-sdk-clients";
import type {
  MemoryInvocationResult,
  MemoryLoadInput,
} from "../src/memory_leak.js";

export interface InvocationStatusCounts {
  succeeded: number;
  failed: number;
  retrying: number;
  suspended: number;
  paused: number;
}

export interface InvocationStatusReportRow extends InvocationStatusCounts {
  round: number;
}

export interface MemoryReportRow {
  round: number | "baseline";
  invocations: number;
  heapAfterGc: number;
  deltaFromPrevious?: number;
  deltaFromBaseline: number;
  heapBeforeCleanup?: number;
}

export interface MemoryLeakReportInput {
  exceededThreshold: boolean;
  measuredInvocations: number;
  baselineHeapUsed: number;
  finalHeapUsed: number;
  totalHeapDelta: number;
  maxHeapDeltaBytes: number;
  invocationStatusRows: InvocationStatusReportRow[];
  roundMemoryRows: MemoryReportRow[];
}

export interface MemoryLeakSendClient {
  succeed(
    input: MemoryLoadInput
  ): Promise<clients.Send<MemoryInvocationResult>>;
  terminalError(input: MemoryLoadInput): Promise<clients.Send<void>>;
  retryForever(input: MemoryLoadInput): Promise<clients.Send<void>>;
  suspendOnAwakeable(
    input: MemoryLoadInput
  ): Promise<clients.Send<MemoryInvocationResult>>;
  pauseAfterMaxAttempts(input: MemoryLoadInput): Promise<clients.Send<void>>;
}

export interface MemoryProbeConfig {
  payloadBytes: number;
  waitTimeout: number;
  cleanupDelay: number;
  invocationsPerInvocationStatusPerRound: number;
  warmupInvocationsPerInvocationStatus: number;
  rounds: number;
  maxHeapDeltaBytes: number;
}

export function envInt(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (value === undefined || value === "") return defaultValue;

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${name} must be an integer, got ${value}`);
  }

  return parsed;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function adminQuery<T>(adminUrl: string, query: string): Promise<T[]> {
  const res = await fetch(`${adminUrl}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    throw new Error(`Admin query failed: ${res.status} ${await res.text()}`);
  }

  const json = (await res.json()) as { rows: T[] };
  return json.rows;
}

export async function invocationStatusCounts(
  adminUrl: string,
  ids: string[]
): Promise<InvocationStatusCounts> {
  const counts: InvocationStatusCounts = {
    succeeded: 0,
    failed: 0,
    retrying: 0,
    suspended: 0,
    paused: 0,
  };

  for (const idsChunk of chunk(ids, 200)) {
    if (idsChunk.length === 0) continue;
    const sqlIds = idsChunk
      .map((id) => `'${id.replaceAll("'", "''")}'`)
      .join(",");

    const rows = await adminQuery<{
      invocation_status: keyof InvocationStatusCounts;
      invocation_count: number | string;
    }>(
      adminUrl,
      `
        SELECT invocation_status, count(1) AS invocation_count
        FROM (
          SELECT
            CASE
              WHEN inv.status = 'completed'
                AND inv.completion_result = 'success'
                THEN 'succeeded'
              WHEN inv.status = 'completed'
                AND inv.completion_result IS NOT NULL
                AND inv.completion_result != 'success'
                THEN 'failed'
              WHEN inv.status = 'suspended'
                THEN 'suspended'
              WHEN inv.status = 'paused'
                THEN 'paused'
              WHEN inv.status = 'running'
                OR inv.status = 'backing-off'
                THEN 'retrying'
              ELSE 'other'
            END AS invocation_status
          FROM sys_invocation inv
          WHERE inv.id IN (${sqlIds})
        ) statuses
        WHERE invocation_status != 'other'
        GROUP BY invocation_status
      `
    );

    for (const row of rows) {
      counts[row.invocation_status] += Number(row.invocation_count);
    }
  }

  return counts;
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

type TableCell = string | number | boolean;

const color = (code: number, text: string) =>
  process.env.RESTATE_E2E_MEMORY_COLOR === "0"
    ? text
    : `\u001b[${code}m${text}\u001b[0m`;
const red = (text: string) => color(31, text);
const green = (text: string) => color(32, text);

function renderTable(headers: string[], rows: TableCell[][]): string {
  const stringRows = rows.map((row) => row.map(String));
  const widths = headers.map((header, columnIndex) =>
    Math.max(
      header.length,
      ...stringRows.map((row) => row[columnIndex]?.length ?? 0)
    )
  );
  const separator = `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`;
  const renderRow = (row: string[]) =>
    `| ${row
      .map((cell, columnIndex) => cell.padEnd(widths[columnIndex] ?? 0))
      .join(" | ")} |`;

  return [
    renderRow(headers),
    separator,
    ...stringRows.map((row) => renderRow(row)),
  ].join("\n");
}

function formatOptionalBytes(bytes: number | undefined): string {
  return bytes === undefined ? "" : formatBytes(bytes);
}

export function renderMemoryLeakReport(input: MemoryLeakReportInput): string {
  const invocationStatusTable = renderTable(
    ["iteration", "succeeded", "failed", "retrying", "suspended", "paused"],
    input.invocationStatusRows.map((row) => [
      row.round,
      row.succeeded,
      row.failed,
      row.retrying,
      row.suspended,
      row.paused,
    ])
  );
  const memoryTable = renderTable(
    [
      "iteration",
      "invocations",
      "heap after GC",
      "delta (vs prev)",
      "delta (vs baseline)",
      "heap before cleanup",
    ],
    input.roundMemoryRows.map((row) => [
      row.round,
      row.invocations,
      formatBytes(row.heapAfterGc),
      formatOptionalBytes(row.deltaFromPrevious),
      formatBytes(row.deltaFromBaseline),
      formatOptionalBytes(row.heapBeforeCleanup),
    ])
  );
  const summaryTable = renderTable(
    ["metric", "value"],
    [
      ["invocations", input.measuredInvocations],
      ["baseline heap", formatBytes(input.baselineHeapUsed)],
      ["final heap after GC", formatBytes(input.finalHeapUsed)],
      ["heap delta (vs baseline)", formatBytes(input.totalHeapDelta)],
      ["retained heap threshold", formatBytes(input.maxHeapDeltaBytes)],
    ]
  );
  const status = input.exceededThreshold ? red("FAIL") : green("PASS");

  return `${status} SDK memory delta check
observed heap delta: ${formatBytes(input.totalHeapDelta)}
threshold: ${formatBytes(input.maxHeapDeltaBytes)}
invocations: ${input.measuredInvocations}

Invocation status by iteration:
${invocationStatusTable}

Memory by iteration:
${memoryTable}

Final heap summary:
${summaryTable}`;
}
