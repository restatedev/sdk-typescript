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

// Records of the durable harness, modelled after pi-durable: immutable transcript entries,
// tasks as durable state machines, submissions, and documents.

export type ToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

export type Message =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      toolCalls?: ToolCall[];
      stopReason: "stop" | "toolUse" | "aborted";
    }
  | {
      role: "toolResult";
      callId: string;
      tool: string;
      content: string;
      isError: boolean;
    };

export type Entry = {
  id: number;
  conversation: string;
  message: Message;
  byTask?: string;
};

/** State a task commits for itself: a new checkpoint, a wait on other tasks, or its outcome. */
export type NextState =
  | { status: "running"; checkpoint: Checkpoint }
  | { status: "waiting"; checkpoint: Checkpoint; on: string[] }
  | { status: "terminal"; outcome: Outcome };

export type Outcome =
  | { status: "completed"; result?: unknown }
  | { status: "failed"; error: string };

export type Checkpoint = { phase: string } & Record<string, unknown>;

export type TaskRecord = {
  id: string;
  kind: string;
  conversation: string;
  /** Owning task, absent for a task its conversation owns. */
  owner?: string;
  /** Incremented by every commit of the task: the commit gate. */
  seq: number;
  input: Record<string, unknown>;
  state: NextState;
};

export type Submission = {
  id: string;
  conversation: string;
  content: string;
  status: "queued" | "running" | "done" | "unanswered";
  answer?: number;
};

/** The conversation's live document: presentation of the running work. */
export type LiveDoc = {
  run?: { taskId: string; inputs: string[] };
  generation?: { attempt: number; partial?: string };
  tools?: Record<string, "running" | "done">;
};

export type InboxDoc = { followUps: string[] };

export type CommitRequest = {
  taskId: string;
  seq: number;
  name: string;
  data?: unknown;
};

export type CommitResult =
  | { ok: true; task: TaskRecord }
  | { ok: false; reason: string };
