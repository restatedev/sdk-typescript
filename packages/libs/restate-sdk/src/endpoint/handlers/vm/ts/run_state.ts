/*
 * Copyright (c) 2023-2025 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

/** Mirrors `vm/run_state.rs` of the shared core. */

import type { NotificationHandle } from "./types.js";

const enum RunStateInner {
  ToExecute,
  Executing,
}

interface Run {
  commandIndex: number;
  commandName: string;
  state: RunStateInner;
}

export class RunState {
  private readonly runs = new Map<NotificationHandle, Run>();

  insertRunToExecute(
    handle: NotificationHandle,
    commandIndex: number,
    commandName: string
  ) {
    this.runs.set(handle, {
      commandIndex,
      commandName,
      state: RunStateInner.ToExecute,
    });
  }

  tryExecuteRun(
    anyHandle: readonly NotificationHandle[]
  ): NotificationHandle | undefined {
    for (const [handle, run] of this.runs) {
      if (run.state === RunStateInner.ToExecute && anyHandle.includes(handle)) {
        run.state = RunStateInner.Executing;
        return handle;
      }
    }
    return undefined;
  }

  getRunInfo(
    handle: NotificationHandle
  ): { commandIndex: number; commandName: string } | undefined {
    const run = this.runs.get(handle);
    if (run === undefined) {
      return undefined;
    }
    return { commandIndex: run.commandIndex, commandName: run.commandName };
  }

  anyExecutingInThisSet(anyHandle: readonly NotificationHandle[]): boolean {
    return anyHandle.some(
      (h) => this.runs.get(h)?.state === RunStateInner.Executing
    );
  }

  anyExecuting(): boolean {
    for (const run of this.runs.values()) {
      if (run.state === RunStateInner.Executing) {
        return true;
      }
    }
    return false;
  }

  notifyExecutionCompleted(executed: NotificationHandle): {
    commandName: string;
    commandIndex: number;
  } {
    const run = this.runs.get(executed);
    if (run === undefined) {
      throw new Error("There must be a corresponding run for the given handle");
    }
    this.runs.delete(executed);
    return { commandName: run.commandName, commandIndex: run.commandIndex };
  }
}
