/*
 * Copyright (c) 2023-2024 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

// Recovery scenarios, run against a restate-server with the harness registered,
// and the harness endpoint restarted whenever it crashes. See README.md.

import assert from "node:assert/strict";
import { arm, sideEffects } from "./crash.js";
import type { Entry, LiveDoc, Submission, TaskRecord } from "./types.js";

const ingress = process.env.INGRESS ?? "http://127.0.0.1:8080";
const run = process.env.RUN_ID ?? Date.now().toString(36);

type View = {
  entries: Entry[];
  submissions: Submission[];
  tasks: TaskRecord[];
  live: LiveDoc | null;
  followUps: string[] | null;
};

async function post<T>(
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<T> {
  const res = await fetch(`${ingress}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`${path}: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

const submit = (
  session: string,
  content: string,
  headers?: Record<string, string>
) => post<string>(`/session/${session}/submit`, { content }, headers);
const view = (session: string) =>
  post<View>(`/session/${session}/view`, "root");

async function settled(
  session: string,
  submissions: string[],
  timeoutMs = 60_000
): Promise<View> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await view(session);
    const done = submissions.every(
      (id) => v.submissions.find((s) => s.id === id)?.status === "done"
    );
    if (done && v.live?.run === undefined) {
      return v;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out waiting for ${submissions.join(", ")}: ${JSON.stringify(v, null, 2)}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

function transcript(v: View): string[] {
  return v.entries.map((e) => {
    const m = e.message;
    switch (m.role) {
      case "user":
        return `user: ${m.content}`;
      case "assistant":
        return `assistant(${m.stopReason}): ${m.content}`;
      case "toolResult":
        return `tool ${m.tool}${m.isError ? " (error)" : ""}: ${m.content}`;
    }
  });
}

const scenarios: Record<string, () => Promise<void>> = {
  chat: async () => {
    const s = `chat-${run}`;
    const v = await settled(s, [await submit(s, "hello")]);
    assert.deepEqual(transcript(v), [
      "user: hello",
      "assistant(stop): You said: hello",
    ]);
  },

  tools: async () => {
    const s = `tools-${run}`;
    const charges = sideEffects("charge");
    const v = await settled(s, [await submit(s, "use tools lookup,charge")]);
    const t = transcript(v);
    assert.equal(t[0], "user: use tools lookup,charge");
    assert.equal(t[1], "assistant(toolUse): Calling lookup and charge");
    assert.deepEqual(t.slice(2, 4).sort(), [
      "tool charge: charged 10 EUR for apple",
      "tool lookup: apple stock is 42",
    ]);
    assert.match(t[4]!, /^assistant\(stop\): Tool results: /);
    assert.equal(sideEffects("charge") - charges, 1);
  },

  "crash in a replay-safe tool": async () => {
    const s = `safe-${run}`;
    const lookups = sideEffects("lookup");
    arm("lookup");
    const v = await settled(s, [await submit(s, "use tools lookup")]);
    assert.deepEqual(transcript(v), [
      "user: use tools lookup",
      "assistant(toolUse): Calling lookup",
      "tool lookup: apple stock is 42",
      "assistant(stop): Tool results: lookup: apple stock is 42",
    ]);
    // Executed by the attempt that crashed, and once more after recovery
    assert.equal(sideEffects("lookup") - lookups, 2);
  },

  "crash in an unsafe tool": async () => {
    const s = `unsafe-${run}`;
    const charges = sideEffects("charge");
    arm("charge");
    const v = await settled(s, [await submit(s, "use tools charge")]);
    assert.deepEqual(transcript(v), [
      "user: use tools charge",
      "assistant(toolUse): Calling charge",
      "tool charge (error): interrupted: the call may or may not have happened",
      "assistant(stop): Tool results: charge: interrupted: the call may or may not have happened",
    ]);
    // Not executed again after the crash
    assert.equal(sideEffects("charge") - charges, 1);
  },

  "crash while streaming": async () => {
    const s = `stream-${run}`;
    arm("stream");
    const content = "a long input that takes a while to stream back";
    const v = await settled(s, [await submit(s, content)]);
    const t = transcript(v);
    assert.equal(t[0], `user: ${content}`);
    // The partial committed by the interrupted attempt is kept as an aborted entry, then the answer
    assert.match(t[1]!, /^assistant\(aborted\): You said: a long/);
    assert.equal(t[2], `assistant(stop): You said: ${content}`);
    assert.equal(t.length, 3);
  },

  "follow-up while busy": async () => {
    const s = `followup-${run}`;
    const first = await submit(s, "use tools slow");
    const second = await submit(s, "second");
    const v = await settled(s, [first, second]);
    assert.deepEqual(transcript(v), [
      "user: use tools slow",
      "assistant(toolUse): Calling slow",
      "tool slow: slow done",
      "assistant(stop): Tool results: slow: slow done",
      "user: second",
      "assistant(stop): You said: second",
    ]);
  },

  "idempotent submit": async () => {
    const s = `idempotent-${run}`;
    const headers = { "idempotency-key": `greeting-${run}` };
    const a = await submit(s, "hello", headers);
    const b = await submit(s, "hello", headers);
    assert.equal(a, b);
    const v = await settled(s, [a]);
    assert.deepEqual(transcript(v), [
      "user: hello",
      "assistant(stop): You said: hello",
    ]);
  },
};

let failed = 0;
for (const [name, scenario] of Object.entries(scenarios)) {
  const start = Date.now();
  try {
    await scenario();
    console.log(`PASS ${name} (${Date.now() - start} ms)`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
process.exit(failed === 0 ? 0 : 1);
