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

// Task definitions. A task is a durable state machine whose checkpoint lives in the Session.
//
// * `phases` run in the TaskRunner, outside of the Session's lock: they perform the external effects
//   (model requests, tool calls) and report progress through named commits.
// * `commits` are the pure functions the Session applies in one transaction: they append entries,
//   edit documents, create tasks, and return the task's next state.
//
// This is pi-durable's "commit intent, perform effect, commit outcome", with the commit callbacks
// turned into named functions, because they must run where the state is.

import { streamModel, type ModelResponse } from "./model.js";
import { tools, type ToolDefinition } from "./tools.js";
import type {
  Checkpoint,
  LiveDoc,
  Message,
  NextState,
  Submission,
  TaskRecord,
  ToolCall,
} from "./types.js";

/** What a phase can do. */
export interface PhaseRuntime {
  /** The task as of its latest commit. */
  readonly task: TaskRecord;
  /** Applies the named commit of this task kind in the Session, exactly once. Throws `StaleTask` if the task moved on. */
  commit(name: string, data?: unknown): Promise<TaskRecord>;
  /** Fire-and-forget progress for watchers, not part of the task's checkpoint. */
  progress(partial: string): void;
  /** The model context of the task's conversation, up to the checkpoint's cutoff. */
  context(): Promise<Message[]>;
}

/** What a commit can do, inside the Session transaction. */
export interface SessionTx {
  append(
    conversation: string,
    message: Message,
    byTask?: string
  ): Promise<number>;
  lastEntryId(conversation: string): Promise<number>;
  live(conversation: string): Promise<LiveDoc>;
  setLive(conversation: string, live: LiveDoc): void;
  submission(id: string): Promise<Submission | undefined>;
  setSubmission(submission: Submission): void;
  followUps(conversation: string): Promise<string[]>;
  setFollowUps(conversation: string, followUps: string[]): void;
  createTask(
    kind: string,
    conversation: string,
    input: Record<string, unknown>,
    checkpoint: Checkpoint,
    owner?: string
  ): Promise<string>;
}

export type TaskDefinition = {
  phases: Record<string, (rt: PhaseRuntime) => Promise<void>>;
  commits: Record<
    string,
    (
      tx: SessionTx,
      task: TaskRecord,
      // The JSON the phase passed to its commit, typed by each commit function
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: any
    ) => Promise<NextState | undefined>
  >;
};

// --- Runs

/** Admits the submissions as user entries and starts a generation for them. */
export async function startRun(
  tx: SessionTx,
  conversation: string,
  live: LiveDoc,
  inputs: string[]
) {
  for (const id of inputs) {
    const submission = (await tx.submission(id))!;
    await tx.append(conversation, {
      role: "user",
      content: submission.content,
    });
    tx.setSubmission({ ...submission, status: "running" });
  }
  const cutoff = await tx.lastEntryId(conversation);
  const taskId = await tx.createTask(
    "generation",
    conversation,
    {},
    {
      phase: "request",
      cutoff,
    }
  );
  live.run = { taskId, inputs };
}

/** Settles the run's inputs with the answer, and starts the next queued follow-up. */
async function finishRun(
  tx: SessionTx,
  conversation: string,
  live: LiveDoc,
  answer: number
) {
  for (const id of live.run?.inputs ?? []) {
    const submission = (await tx.submission(id))!;
    tx.setSubmission({ ...submission, status: "done", answer });
  }
  delete live.run;
  const [next, ...rest] = await tx.followUps(conversation);
  if (next !== undefined) {
    tx.setFollowUps(conversation, rest);
    await startRun(tx, conversation, live, [next]);
  }
}

// --- Generation: request the model, run the tool round, hand over to the next generation

const generation: TaskDefinition = {
  phases: {
    request: async (rt) => {
      await rt.commit("start");
      const messages = await rt.context();
      let lastProgress = 0;
      const response = await streamModel(messages, (partial) => {
        if (Date.now() - lastProgress >= 100) {
          lastProgress = Date.now();
          rt.progress(partial);
        }
      });
      await rt.commit("response", response);
    },
    tools: async (rt) => {
      await rt.commit("toolsDone");
    },
  },
  commits: {
    // A new attempt: the partial left by an interrupted attempt becomes an aborted entry
    start: async (tx, task) => {
      const live = await tx.live(task.conversation);
      if (live.generation?.partial !== undefined) {
        await tx.append(
          task.conversation,
          {
            role: "assistant",
            content: live.generation.partial,
            stopReason: "aborted",
          },
          task.id
        );
      }
      live.generation = { attempt: (live.generation?.attempt ?? 0) + 1 };
      tx.setLive(task.conversation, live);
      return undefined;
    },
    response: async (tx, task, response: ModelResponse) => {
      const conversation = task.conversation;
      const live = await tx.live(conversation);
      delete live.generation;
      const calls = response.toolCalls ?? [];
      const answer = await tx.append(
        conversation,
        {
          role: "assistant",
          content: response.content,
          toolCalls: calls.length > 0 ? calls : undefined,
          stopReason: calls.length > 0 ? "toolUse" : "stop",
        },
        task.id
      );
      if (calls.length > 0) {
        // The tool round: one task per call, owned by this generation, which waits for all of them
        const toolTasks = [];
        live.tools = {};
        for (const call of calls) {
          toolTasks.push(
            await tx.createTask(
              "tool",
              conversation,
              { call },
              { phase: "call" },
              task.id
            )
          );
          live.tools[call.id] = "running";
        }
        tx.setLive(conversation, live);
        return {
          status: "waiting",
          checkpoint: { phase: "tools", answer, tools: toolTasks },
          on: toolTasks,
        };
      }
      await finishRun(tx, conversation, live, answer);
      tx.setLive(conversation, live);
      return {
        status: "terminal",
        outcome: { status: "completed", result: { answer } },
      };
    },
    // Every tool task is terminal: hand the run over to the next generation
    toolsDone: async (tx, task) => {
      const conversation = task.conversation;
      const live = await tx.live(conversation);
      delete live.tools;
      const cutoff = await tx.lastEntryId(conversation);
      const next = await tx.createTask(
        "generation",
        conversation,
        {},
        {
          phase: "request",
          cutoff,
        }
      );
      live.run = { inputs: live.run?.inputs ?? [], taskId: next };
      tx.setLive(conversation, live);
      return { status: "terminal", outcome: { status: "completed" } };
    },
  },
};

// --- Tool: intent, effect, outcome

async function executeTool(
  rt: PhaseRuntime,
  tool: ToolDefinition,
  call: ToolCall
) {
  let result;
  try {
    result = { content: await tool.execute(call.args), isError: false };
  } catch (e) {
    result = { content: `error: ${String(e)}`, isError: true };
  }
  await rt.commit("result", result);
}

const tool: TaskDefinition = {
  phases: {
    call: async (rt) => {
      const { call } = rt.task.input as { call: ToolCall };
      const definition = tools[call.name];
      if (definition === undefined) {
        await rt.commit("result", {
          content: `unknown tool ${call.name}`,
          isError: true,
        });
        return;
      }
      // From now on, the effect may have happened
      await rt.commit("intent", { replay: definition.replay });
      await executeTool(rt, definition, call);
    },
    // Reached only by recovery: the previous attempt may or may not have executed the tool
    execute: async (rt) => {
      const { call } = rt.task.input as { call: ToolCall };
      const definition = tools[call.name];
      if (
        rt.task.state.status === "running" &&
        rt.task.state.checkpoint.replay === "safe" &&
        definition?.replay === "safe"
      ) {
        await executeTool(rt, definition, call);
      } else {
        await rt.commit("result", {
          content: "interrupted: the call may or may not have happened",
          isError: true,
        });
      }
    },
  },
  commits: {
    intent: async (_tx, _task, data: { replay: string }) => ({
      status: "running",
      checkpoint: { phase: "execute", replay: data.replay },
    }),
    result: async (tx, task, data: { content: string; isError: boolean }) => {
      const { call } = task.input as { call: ToolCall };
      const entry = await tx.append(
        task.conversation,
        {
          role: "toolResult",
          callId: call.id,
          tool: call.name,
          content: data.content,
          isError: data.isError,
        },
        task.id
      );
      const live = await tx.live(task.conversation);
      if (live.tools !== undefined) {
        live.tools[call.id] = "done";
      }
      tx.setLive(task.conversation, live);
      return {
        status: "terminal",
        outcome: data.isError
          ? { status: "failed", error: data.content }
          : { status: "completed", result: { entry } },
      };
    },
  },
};

export const definitions: Record<string, TaskDefinition> = { generation, tool };
