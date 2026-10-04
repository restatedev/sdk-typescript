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

// The Session: pi-durable's single mutation line. One virtual object per session,
// every exclusive handler is one short atomic transaction over the session state:
// transcript entries, task records, submissions and documents.
//
// It uses lazy state: transactions fetch the keys they need with `kv.load`,
// so the transcript doesn't have to be shipped with every invocation.

import {
  handlers,
  object,
  TerminalError,
  type ActorContext,
  type ObjectContext,
  type ObjectSharedContext,
} from "@restatedev/restate-sdk";
import type { taskRunner } from "./runner.js";
import { definitions, startRun, type SessionTx } from "./tasks.js";
import type {
  Checkpoint,
  CommitRequest,
  CommitResult,
  Entry,
  LiveDoc,
  Message,
  Submission,
  TaskRecord,
} from "./types.js";

const TaskRunner = { name: "taskRunner" } as typeof taskRunner;

class Tx implements SessionTx {
  constructor(
    private readonly tx: ActorContext,
    private readonly sessionId: string
  ) {}

  private load<T>(key: string): Promise<T | undefined> {
    return this.tx.kv.load<T>(key);
  }

  async append(conversation: string, message: Message, byTask?: string) {
    const id = (await this.lastEntryId(conversation)) + 1;
    const entry: Entry = { id, conversation, message, byTask };
    this.tx.kv.set(`conv/${conversation}/entry/${id}`, entry);
    this.tx.kv.set(`conv/${conversation}/head`, id);
    return id;
  }

  async lastEntryId(conversation: string) {
    return (await this.load<number>(`conv/${conversation}/head`)) ?? 0;
  }

  async live(conversation: string) {
    return (await this.load<LiveDoc>(`conv/${conversation}/live`)) ?? {};
  }

  setLive(conversation: string, live: LiveDoc) {
    this.tx.kv.set(`conv/${conversation}/live`, live);
  }

  submission(id: string) {
    return this.load<Submission>(`sub/${id}`);
  }

  setSubmission(submission: Submission) {
    this.tx.kv.set(`sub/${submission.id}`, submission);
  }

  async followUps(conversation: string) {
    return (await this.load<string[]>(`conv/${conversation}/followUps`)) ?? [];
  }

  setFollowUps(conversation: string, followUps: string[]) {
    this.tx.kv.set(`conv/${conversation}/followUps`, followUps);
  }

  async nextId(kind: string) {
    const n = ((await this.load<number>(`seq/${kind}`)) ?? 0) + 1;
    this.tx.kv.set(`seq/${kind}`, n);
    return `${kind}-${n}`;
  }

  task(id: string) {
    return this.load<TaskRecord>(`task/${id}`);
  }

  saveTask(task: TaskRecord) {
    this.tx.kv.set(`task/${task.id}`, task);
  }

  /** Runs the task: sent only if this transaction commits. */
  startRunner(taskId: string) {
    this.tx.objectSendClient(TaskRunner, `${this.sessionId}:${taskId}`).run();
  }

  async createTask(
    kind: string,
    conversation: string,
    input: Record<string, unknown>,
    checkpoint: Checkpoint,
    owner?: string
  ) {
    const id = await this.nextId("task");
    this.saveTask({
      id,
      kind,
      conversation,
      owner,
      seq: 0,
      input,
      state: { status: "running", checkpoint },
    });
    this.startRunner(id);
    return id;
  }
}

/** Resumes the owner of a task that just became terminal, once every task it waits on is terminal. */
async function wakeOwner(tx: Tx, ownerId: string) {
  const owner = await tx.task(ownerId);
  if (owner?.state.status !== "waiting") {
    return;
  }
  for (const id of owner.state.on) {
    if ((await tx.task(id))?.state.status !== "terminal") {
      return;
    }
  }
  tx.saveTask({
    ...owner,
    seq: owner.seq + 1,
    state: { status: "running", checkpoint: owner.state.checkpoint },
  });
  tx.startRunner(ownerId);
}

/** Reads the keys `key(1)`..`key(n)`: there are no range reads, records are numbered instead. */
async function readAll<T>(
  ctx: ObjectSharedContext,
  n: number,
  key: (i: number) => string
): Promise<T[]> {
  const values: T[] = [];
  for (let i = 1; i <= n; i++) {
    values.push((await ctx.get<T>(key(i)))!);
  }
  return values;
}

export const session = object({
  name: "session",
  options: { journal: "storage", enableLazyState: true },
  handlers: {
    /** Admits an input: answered now if the conversation is idle, queued as a follow-up otherwise. */
    submit: async (
      ctx: ObjectContext,
      req: { content: string; conversation?: string }
    ): Promise<string> =>
      ctx.transaction("submit", async (raw) => {
        const tx = new Tx(raw, ctx.key);
        const conversation = req.conversation ?? "root";
        const id = await tx.nextId("sub");
        tx.setSubmission({
          id,
          conversation,
          content: req.content,
          status: "queued",
        });
        const live = await tx.live(conversation);
        if (live.run !== undefined) {
          tx.setFollowUps(conversation, [
            ...(await tx.followUps(conversation)),
            id,
          ]);
        } else {
          await startRun(tx, conversation, live, [id]);
          tx.setLive(conversation, live);
        }
        return id;
      }),

    /** Applies a named commit of a task, if the task is still at the checkpoint the runner knows. */
    commit: async (
      ctx: ObjectContext,
      req: CommitRequest
    ): Promise<CommitResult> =>
      ctx.transaction("commit", async (raw): Promise<CommitResult> => {
        const tx = new Tx(raw, ctx.key);
        const task = await tx.task(req.taskId);
        if (task === undefined) {
          return { ok: false, reason: "unknown task" };
        }
        if (task.state.status !== "running") {
          return { ok: false, reason: `task is ${task.state.status}` };
        }
        if (task.seq !== req.seq) {
          return {
            ok: false,
            reason: `commit for ${req.seq}, task is at ${task.seq}`,
          };
        }
        const commit = definitions[task.kind]?.commits[req.name];
        if (commit === undefined) {
          throw new TerminalError(`Unknown commit ${task.kind}.${req.name}`);
        }
        const next = await commit(tx, task, req.data);
        const updated: TaskRecord = {
          ...task,
          seq: task.seq + 1,
          state: next ?? task.state,
        };
        tx.saveTask(updated);
        if (
          updated.state.status === "terminal" &&
          updated.owner !== undefined
        ) {
          await wakeOwner(tx, updated.owner);
        }
        return { ok: true, task: updated };
      }),

    /** Throttled partial output of a generation, dropped if the generation moved on. */
    progress: async (
      ctx: ObjectContext,
      req: { taskId: string; seq: number; partial: string }
    ) =>
      ctx.transaction("progress", async (raw) => {
        const tx = new Tx(raw, ctx.key);
        const task = await tx.task(req.taskId);
        if (task?.state.status !== "running" || task.seq !== req.seq) {
          return;
        }
        const live = await tx.live(task.conversation);
        if (live.generation !== undefined) {
          live.generation.partial = req.partial;
          tx.setLive(task.conversation, live);
        }
      }),

    task: handlers.object.shared(async (ctx: ObjectSharedContext, id: string) =>
      ctx.get<TaskRecord>(`task/${id}`)
    ),

    /** The model context: the conversation messages up to `cutoff`, without aborted attempts. */
    context: handlers.object.shared(
      async (
        ctx: ObjectSharedContext,
        req: { conversation: string; cutoff: number }
      ): Promise<Message[]> => {
        const entries = await readAll<Entry>(
          ctx,
          req.cutoff,
          (i) => `conv/${req.conversation}/entry/${i}`
        );
        return entries
          .map((e) => e.message)
          .filter(
            (m) => !(m.role === "assistant" && m.stopReason === "aborted")
          );
      }
    ),

    /**
     * Everything a watcher needs: the transcript, the live document, the submissions.
     *
     * Lazy reads are not snapshot-consistent: each one reads the current state, so a commit landing between
     * two reads gives a view that never existed. This handler gets the eager snapshot instead.
     */
    view: handlers.object.shared(
      { enableLazyState: false },
      async (ctx: ObjectSharedContext, conversation?: string) => {
        const conv = conversation ?? "root";
        const head = (await ctx.get<number>(`conv/${conv}/head`)) ?? 0;
        const subs = (await ctx.get<number>("seq/sub")) ?? 0;
        const tasks = (await ctx.get<number>("seq/task")) ?? 0;
        return {
          entries: await readAll<Entry>(
            ctx,
            head,
            (i) => `conv/${conv}/entry/${i}`
          ),
          submissions: await readAll<Submission>(
            ctx,
            subs,
            (i) => `sub/sub-${i}`
          ),
          tasks: await readAll<TaskRecord>(ctx, tasks, (i) => `task/task-${i}`),
          live: await ctx.get<LiveDoc>(`conv/${conv}/live`),
          followUps: await ctx.get<string[]>(`conv/${conv}/followUps`),
        };
      }
    ),
  },
});
