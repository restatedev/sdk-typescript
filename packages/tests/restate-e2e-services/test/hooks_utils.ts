// Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
//
// This file is part of the Restate e2e tests,
// which are released under the MIT license.
//
// You can find a copy of the license in file LICENSE in the root
// directory of this repository or package, or at
// https://github.com/restatedev/e2e/blob/main/LICENSE

import { expect } from "vitest";
import * as clients from "@restatedev/restate-sdk-clients";
import { hooksTestDriver } from "../src/hooks.js";
import { getIngressUrl } from "./utils.js";

export const hooksDriver = clients
  .connect({ url: getIngressUrl() })
  .serviceClient(hooksTestDriver);

export async function invokeExpectingError(
  fn: () => Promise<unknown>
): Promise<{ events: string[]; invocationId?: string }> {
  const idsBefore = await hooksDriver.getInvocationIds();
  try {
    await fn();
  } catch {
    // expected
  }
  await expect
    .poll(() => hooksDriver.findNewInvocation(idsBefore), {
      timeout: 10_000,
      interval: 100,
    })
    .toMatchObject({ invocationId: expect.any(String) });
  const invocation = await hooksDriver.findNewInvocation(idsBefore);
  return invocation ?? { events: [] };
}

export async function waitForInvocationOutcome(
  adminAPIBaseUrl: string,
  invocationId: string,
  expected: object,
  options?: {
    timeout?: number;
    interval?: number;
  }
): Promise<InvocationOutcome> {
  let outcome: InvocationOutcome | undefined;

  await expect
    .poll(
      async () => {
        outcome = await getInvocationOutcome(adminAPIBaseUrl, invocationId);
        return outcome;
      },
      {
        timeout: options?.timeout ?? 10_000,
        interval: options?.interval ?? 100,
      }
    )
    .toMatchObject(expected);

  return outcome!;
}

export function inAnyOrder(...events: (string | RegExp)[]): string[] {
  const pattern = events
    .map((e) =>
      e instanceof RegExp ? e.source : e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    )
    .join("|");
  const matcher: string = expect.stringMatching(new RegExp(`^(${pattern})$`));
  return events.map(() => matcher);
}

export interface TransientError {
  error_code: number;
  error_message: string;
  related_command_type?: string;
  related_command_name?: string;
  related_command_index?: number;
}

export interface InvocationOutcome {
  status: string;
  journalOutput?: {
    value?: unknown;
    failure?: {
      code: number;
      message: string;
      metadata?: Record<string, string>;
    };
  };
  transientErrors?: TransientError[];
}

async function getInvocationOutcome(
  adminUrl: string,
  invocationId: string
): Promise<InvocationOutcome> {
  const res = await fetch(`${adminUrl}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      query: `
        SELECT
          i.status,
          i.completion_result,
          i.completion_failure,
          j.entry_json
        FROM sys_invocation i
        LEFT JOIN sys_journal j ON i.id = j.id AND j.entry_type = 'Command: Output'
        WHERE i.id = '${invocationId}'
      `,
    }),
  });
  const json = (await res.json()) as {
    rows: {
      status: string;
      completion_result: string | null;
      completion_failure: string | null;
      entry_json: string | null;
    }[];
  };
  const row = json.rows[0];
  if (!row) return { status: "not_found" };
  if (row.status !== "completed") return { status: row.status };

  let journalOutput:
    | {
        value?: unknown;
        failure?: {
          code: number;
          message: string;
          metadata?: Record<string, string>;
        };
      }
    | undefined;
  if (row.entry_json) {
    const entry = JSON.parse(row.entry_json) as {
      Command?: {
        Output?: {
          result?: {
            Success?: number[];
            Failure?: {
              code: number;
              message: string;
              metadata?: { key: string; value: string }[];
            };
          };
        };
      };
    };
    const result = entry?.Command?.Output?.result;
    if (result?.Success) {
      const decoded = new TextDecoder().decode(new Uint8Array(result.Success));
      try {
        journalOutput = { value: JSON.parse(decoded) as unknown };
      } catch {
        journalOutput = { value: decoded };
      }
    } else if (result?.Failure) {
      const metadata = result.Failure.metadata?.length
        ? Object.fromEntries(
            result.Failure.metadata.map((m) => [m.key, m.value])
          )
        : undefined;
      journalOutput = {
        failure: {
          code: result.Failure.code,
          message: result.Failure.message,
          metadata,
        },
      };
    }
  }

  const eventsRes = await fetch(`${adminUrl}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      query: `SELECT event_json FROM sys_journal_events WHERE id = '${invocationId}' AND event_type = 'TransientError' ORDER BY appended_at`,
    }),
  });
  const eventsJson = (await eventsRes.json()) as {
    rows: { event_json: string }[];
  };
  const transientErrors: TransientError[] = eventsJson.rows.map((r) => {
    const event = JSON.parse(r.event_json) as {
      error_code: number;
      error_message: string;
      related_command_type?: string;
      related_command_name?: string;
      related_command_index?: number;
    };
    const te: TransientError = {
      error_code: event.error_code,
      error_message: event.error_message,
    };
    if (event.related_command_type != null)
      te.related_command_type = event.related_command_type;
    if (event.related_command_name != null)
      te.related_command_name = event.related_command_name;
    if (event.related_command_index != null)
      te.related_command_index = event.related_command_index;
    return te;
  });

  return {
    status: row.completion_result === "success" ? "succeeded" : "failed",
    journalOutput,
    transientErrors: transientErrors.length > 0 ? transientErrors : undefined,
  };
}

export async function getRunJournalEntry(
  adminUrl: string,
  invocationId: string
): Promise<{ value?: unknown; failure?: string } | undefined> {
  const res = await fetch(`${adminUrl}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      query: `SELECT entry_json FROM sys_journal WHERE id = '${invocationId}' AND entry_type = 'Notification: Run'`,
    }),
  });
  const json = (await res.json()) as {
    rows: { entry_json: string }[];
  };
  const row = json.rows[0];
  if (!row) return undefined;
  const entry = JSON.parse(row.entry_json) as {
    Notification?: {
      Completion?: {
        Run?: {
          result?: {
            Success?: number[];
            Failure?: { code: number; message: string };
          };
        };
      };
    };
  };
  const result = entry?.Notification?.Completion?.Run?.result;
  if (result?.Success) {
    const decoded = new TextDecoder().decode(new Uint8Array(result.Success));
    try {
      return { value: JSON.parse(decoded) as unknown };
    } catch {
      return { value: decoded };
    }
  } else if (result?.Failure) {
    return { failure: result.Failure.message };
  }
  return undefined;
}

export async function cancelInvocationViaAdminApi(
  adminUrl: string,
  invocationId: string
): Promise<void> {
  const res = await fetch(`${adminUrl}/invocations/${invocationId}/cancel`, {
    method: "PATCH",
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    const badResponse = await res.text();
    throw new Error(
      `Error ${res.status} during invocation cancel: ${badResponse}`
    );
  }
}

export async function pauseInvocationViaAdminApi(
  adminUrl: string,
  invocationId: string
): Promise<void> {
  const res = await fetch(`${adminUrl}/invocations/${invocationId}/pause`, {
    method: "PATCH",
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    const badResponse = await res.text();
    throw new Error(
      `Error ${res.status} during invocation pause: ${badResponse}`
    );
  }
}
