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

import * as restate from "../public_api";
import { LifecycleStatus, WorkflowStartResult } from "./workflow";

const LIFECYCLE_STATUS_STATE_NAME = "status";
const RESULT_STATE_NAME = "result";
const RESULT_LISTENERS_NAME = "result_listeners";
const PROMISE_STATE_PREFIX = "prom_s_";
const USER_STATE_PREFIX = "state_";
const PROMISE_AWAKEABLE_PREFIX = "prom_l_";

export type ValueOrError<T> = {
  value?: T;
  error?: string;
};

export type api<P extends string> = restate.VirtualObjectDefinition<
  P,
  restate.VirtualObject<typeof workflowStateService>
>;

export const workflowStateService = {
  startWorkflow: async (
    ctx: restate.ObjectContext
  ): Promise<WorkflowStartResult> => {
    const status =
      (await ctx.get<LifecycleStatus>(LIFECYCLE_STATUS_STATE_NAME)) ??
      LifecycleStatus.NOT_STARTED;

    if (status !== LifecycleStatus.NOT_STARTED) {
      return status === LifecycleStatus.RUNNING
        ? WorkflowStartResult.ALREADY_STARTED
        : WorkflowStartResult.ALREADY_FINISHED;
    }

    ctx.set(LIFECYCLE_STATUS_STATE_NAME, LifecycleStatus.RUNNING);
    return WorkflowStartResult.STARTED;
  },

  finishOrFailWorkflow: async <R>(
    ctx: restate.ObjectContext,
    result: ValueOrError<R>
  ): Promise<void> => {
    if (result.error === undefined && result.value === undefined) {
      throw new restate.TerminalError("Result is undefined");
    }

    const status =
      (await ctx.get<LifecycleStatus>(LIFECYCLE_STATUS_STATE_NAME)) ??
      LifecycleStatus.NOT_STARTED;

    if (status !== LifecycleStatus.RUNNING) {
      // not sure this can ever happen, but we put this here defensively
      throw new restate.TerminalError("Unexpected state: " + status);
    }

    const newStatus = result.error
      ? LifecycleStatus.FAILED
      : LifecycleStatus.FINISHED;
    ctx.set(LIFECYCLE_STATUS_STATE_NAME, newStatus);

    await completePromise(
      ctx,
      RESULT_STATE_NAME,
      RESULT_LISTENERS_NAME,
      result
    );
  },

  getStatus: async (ctx: restate.ObjectContext): Promise<LifecycleStatus> => {
    return (
      (await ctx.get<LifecycleStatus>(LIFECYCLE_STATUS_STATE_NAME)) ??
      LifecycleStatus.NOT_STARTED
    );
  },

  completePromise: async <T>(
    ctx: restate.ObjectContext,
    req: { promiseName: string; completion: ValueOrError<T> }
  ): Promise<void> => {
    // we don't accept writes after the workflow is done
    if (!(await checkIfRunning(ctx))) {
      return;
    }

    await completePromise(
      ctx,
      PROMISE_STATE_PREFIX + req.promiseName,
      PROMISE_AWAKEABLE_PREFIX + req.promiseName,
      req.completion
    );
  },

  peekPromise: async <T>(
    ctx: restate.ObjectContext,
    req: { promiseName: string }
  ): Promise<ValueOrError<T> | null> => {
    return peekPromise(ctx, PROMISE_STATE_PREFIX + req.promiseName);
  },

  subscribePromise: async <T>(
    ctx: restate.ObjectContext,
    req: { promiseName: string; awkId: string }
  ): Promise<ValueOrError<T> | null> => {
    return subscribePromise(
      ctx,
      PROMISE_STATE_PREFIX + req.promiseName,
      PROMISE_AWAKEABLE_PREFIX + req.promiseName,
      req.awkId
    );
  },

  getResult: async <R>(
    ctx: restate.ObjectContext
  ): Promise<ValueOrError<R> | null> => {
    return peekPromise(ctx, RESULT_STATE_NAME);
  },

  subscribeResult: async <T>(
    ctx: restate.ObjectContext,
    awkId: string
  ): Promise<ValueOrError<T> | null> => {
    const status =
      (await ctx.get(LIFECYCLE_STATUS_STATE_NAME)) ??
      LifecycleStatus.NOT_STARTED;
    if (status === LifecycleStatus.NOT_STARTED) {
      throw new restate.TerminalError(
        `Workflow with id '${ctx.key}' does not exist.`
      );
    }
    return subscribePromise(
      ctx,
      RESULT_STATE_NAME,
      RESULT_LISTENERS_NAME,
      awkId
    );
  },

  getState: async <T>(
    ctx: restate.ObjectContext,
    stateName: string
  ): Promise<T | null> => {
    return ctx.get(USER_STATE_PREFIX + stateName);
  },

  setState: async <T>(
    ctx: restate.ObjectContext,
    request: { stateName: string; value: T }
  ): Promise<void> => {
    if (!request?.stateName) {
      throw new restate.TerminalError("missing state name");
    }
    if (request.value === undefined || request.value === null) {
      throw new restate.TerminalError("invalid state value: " + request.value);
    }

    // if the workflow isn't running (any more) we don't accept state updates
    // shouldn't be possible anyways (because only workflow method has access to writable state)
    // but we are defensive here against API errors
    if (!(await checkIfRunning(ctx))) {
      return;
    }

    const stateName = USER_STATE_PREFIX + request.stateName;

    ctx.set(stateName, request.value);
  },

  clearState: async (
    ctx: restate.ObjectContext,
    stateName: string
  ): Promise<void> => {
    ctx.clear(USER_STATE_PREFIX + stateName);
  },

  stateKeys: async (ctx: restate.ObjectContext): Promise<Array<string>> => {
    return (await ctx.stateKeys()).filter((name) =>
      name.startsWith(USER_STATE_PREFIX)
    );
  },

  clearAllState: async (ctx: restate.ObjectContext): Promise<void> => {
    const stateNames = (await ctx.stateKeys()).filter((name) =>
      name.startsWith(USER_STATE_PREFIX)
    );
    for (const stateName of stateNames) {
      ctx.clear(stateName);
    }
  },

  dispose: async (ctx: restate.ObjectContext): Promise<void> => {
    ctx.clearAll();
  },
};

// ----------------------------------------------------------------------------

async function completePromise<T>(
  ctx: restate.ObjectContext,
  stateName: string,
  awakeableStateName: string,
  completion: ValueOrError<T>
): Promise<ValueOrError<T>> {
  if (completion.value !== undefined && completion.error !== undefined) {
    throw new restate.TerminalError(
      "Completion can only be either with value or with error"
    );
  }
  if (completion.value !== undefined && completion.value === null) {
    throw new restate.TerminalError("promise cannot be completed with null");
  }
  if (completion.error !== undefined && completion.error === null) {
    throw new restate.TerminalError("promise cannot be rejected with null");
  }

  const currVal = await ctx.get<ValueOrError<T>>(stateName);
  if (currVal !== null) {
    // promise already completed
    return currVal;
  }

  // first completor
  // (a) set state
  ctx.set(stateName, completion);

  // (b) complete awaiting awakeables
  const listeners = (await ctx.get<string[]>(awakeableStateName)) ?? [];
  listeners.forEach((awkId: string) => {
    if (completion.error !== undefined) {
      ctx.rejectAwakeable(awkId, completion.error);
    } else {
      ctx.resolveAwakeable(awkId, completion.value);
    }
  });
  ctx.clear(awakeableStateName);

  return completion;
}

async function subscribePromise<T>(
  ctx: restate.ObjectContext,
  stateName: string,
  awakeableStateName: string,
  awakeableId: string
): Promise<ValueOrError<T> | null> {
  const currVal = await ctx.get<ValueOrError<T>>(stateName);

  // case (a), we have a value already
  if (currVal !== null) {
    if (currVal.error !== undefined) {
      ctx.rejectAwakeable(awakeableId, currVal.error);
    } else {
      ctx.resolveAwakeable(awakeableId, currVal.value);
    }
    return currVal;
  }

  // case (b), we remember the awk Id and get when we have a value
  // but only if the workflow is still running
  if (!(await checkIfRunning(ctx))) {
    const response = {
      error: "Promised will never resolve because workflow is not running",
    };
    ctx.rejectAwakeable(awakeableId, response.error);
    return response;
  }

  const listeners = (await ctx.get<string[]>(awakeableStateName)) ?? [];
  listeners.push(awakeableId);
  ctx.set(awakeableStateName, listeners);
  return null;
}

async function peekPromise<T>(
  ctx: restate.ObjectContext,
  stateName: string
): Promise<ValueOrError<T> | null> {
  return ctx.get<ValueOrError<T>>(stateName);
}

async function checkIfRunning(ctx: restate.ObjectContext): Promise<boolean> {
  const status = await ctx.get<LifecycleStatus>(LIFECYCLE_STATUS_STATE_NAME);
  return status === LifecycleStatus.RUNNING;
}
