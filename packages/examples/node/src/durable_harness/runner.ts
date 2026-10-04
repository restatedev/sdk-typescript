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

// The TaskRunner executes the phases of one task, outside of the Session's lock,
// so a long model request doesn't block submissions and other tasks of the session.
//
// It runs in the storage journal mode: nothing is replayed, and on every attempt the runner
// * loads the task's current checkpoint with a fresh call: the checkpoint is the recovery signal,
//   e.g. a tool task found in its `execute` phase was interrupted after its intent was committed,
// * commits through calls named after the checkpoint sequence number, so each commit is applied once
//   even if the attempt dies while the call is in flight.

import {
  handlers,
  object,
  rpc,
  TerminalError,
  type ObjectContext,
} from "@restatedev/restate-sdk";
import type { session } from "./session.js";
import { definitions, type PhaseRuntime } from "./tasks.js";
import type { Message, TaskRecord } from "./types.js";

const Session = { name: "session" } as typeof session;

class StaleTask extends Error {}

class Runtime implements PhaseRuntime {
  constructor(
    private readonly ctx: ObjectContext,
    private readonly sessionId: string,
    public task: TaskRecord
  ) {}

  async commit(name: string, data?: unknown): Promise<TaskRecord> {
    const result = await this.ctx
      .objectClient(Session, this.sessionId)
      .commit(
        { taskId: this.task.id, seq: this.task.seq, name, data },
        rpc.opts({ name: `commit:${this.task.seq}:${name}` })
      );
    if (!result.ok) {
      throw new StaleTask(result.reason);
    }
    this.task = result.task;
    return result.task;
  }

  progress(partial: string) {
    this.ctx
      .objectSendClient(Session, this.sessionId)
      .progress(
        { taskId: this.task.id, seq: this.task.seq, partial },
        rpc.sendOpts({ name: "progress", fresh: true })
      );
  }

  async context(): Promise<Message[]> {
    const checkpoint =
      this.task.state.status === "running"
        ? this.task.state.checkpoint
        : undefined;
    // The entries up to the cutoff are immutable: the stored result of a previous attempt is as good as a new one
    return this.ctx.objectClient(Session, this.sessionId).context(
      {
        conversation: this.task.conversation,
        cutoff: Number(checkpoint?.cutoff ?? 0),
      },
      rpc.opts({ name: `context:${this.task.seq}` })
    );
  }
}

export const taskRunner = object({
  name: "taskRunner",
  handlers: {
    /** Key: `${sessionId}:${taskId}`, so a task has at most one running invocation. */
    run: handlers.object.exclusive(
      { journal: "storage" },
      async (ctx: ObjectContext) => {
        const separator = ctx.key.lastIndexOf(":");
        const sessionId = ctx.key.slice(0, separator);
        const taskId = ctx.key.slice(separator + 1);

        for (;;) {
          const task = await ctx
            .objectClient(Session, sessionId)
            .task(taskId, rpc.opts({ name: "load", fresh: true }));
          if (task === null || task.state.status !== "running") {
            // Waiting tasks are resumed by the Session, terminal ones are done
            return;
          }
          const phase =
            definitions[task.kind]?.phases[task.state.checkpoint.phase];
          if (phase === undefined) {
            throw new TerminalError(
              `Unknown phase ${task.kind}.${task.state.checkpoint.phase}`
            );
          }
          ctx.console.info(
            `Task ${taskId} (${task.kind}) phase ${task.state.checkpoint.phase} at ${task.seq}`
          );
          const runtime = new Runtime(ctx, sessionId, task);
          try {
            await phase(runtime);
          } catch (e) {
            if (e instanceof StaleTask) {
              ctx.console.info(`Task ${taskId} moved on: ${e.message}`);
              return;
            }
            throw e;
          }
          if (runtime.task.seq === task.seq) {
            throw new TerminalError(
              `Phase ${task.state.checkpoint.phase} made no durable progress`
            );
          }
        }
      }
    ),
  },
});
