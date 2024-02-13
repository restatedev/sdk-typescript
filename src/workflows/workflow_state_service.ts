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
import {
  LifecycleStatus,
  StatusMessage,
  WorkflowStartResult,
} from "./workflow";

const LIFECYCLE_STATUS_STATE_NAME = "status";
const RESULT_STATE_NAME = "result";
const RESULT_LISTENERS_NAME = "result_listeners";
const STATUS_MESSAGES_STATE_NAME = "messages";
const STATUS_MESSAGE_LISTENERS = "message_listeners";
const PROMISE_STATE_PREFIX = "prom_s_";
const PROMISE_AWAKEABLE_PREFIX = "prom_l_";
const ALL_NAMES_STATE_NAME = "all_state_names";

const RESERVED_STATE_NAMES = [
  LIFECYCLE_STATUS_STATE_NAME,
  RESULT_STATE_NAME,
  RESULT_LISTENERS_NAME,
  ALL_NAMES_STATE_NAME,
];
const RESERVED_STATE_PREFIXES = [
  PROMISE_STATE_PREFIX,
  PROMISE_AWAKEABLE_PREFIX,
];

export type ValueOrError<T> = {
  value?: T;
  error?: string;
};

export const workflowStateService = restate.keyedRouter({
  startWorkflow: async (
    ctx: restate.KeyedContext
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
    ctx: restate.KeyedContext,
    _workflowId: string,
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

  getStatus: async (ctx: restate.KeyedContext): Promise<LifecycleStatus> => {
    return (
      (await ctx.get<LifecycleStatus>(LIFECYCLE_STATUS_STATE_NAME)) ??
      LifecycleStatus.NOT_STARTED
    );
  },

  completePromise: async <T>(
    ctx: restate.KeyedContext,
    _workflowId: string,
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
    ctx: restate.KeyedContext,
    _workflowId: string,
    req: { promiseName: string }
  ): Promise<ValueOrError<T> | null> => {
    return peekPromise(ctx, PROMISE_STATE_PREFIX + req.promiseName);
  },

  subscribePromise: async <T>(
    ctx: restate.KeyedContext,
    _workflowId: string,
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
    ctx: restate.KeyedContext
  ): Promise<ValueOrError<R> | null> => {
    return peekPromise(ctx, RESULT_STATE_NAME);
  },

  subscribeResult: async <T>(
    ctx: restate.KeyedContext,
    workflowId: string,
    awkId: string
  ): Promise<ValueOrError<T> | null> => {
    const status =
      (await ctx.get(LIFECYCLE_STATUS_STATE_NAME)) ??
      LifecycleStatus.NOT_STARTED;
    if (status === LifecycleStatus.NOT_STARTED) {
      throw new restate.TerminalError(
        `Workflow with id '${workflowId}' does not exist.`
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
    ctx: restate.KeyedContext,
    _workflowId: string,
    stateName: string
  ): Promise<T | null> => {
    return ctx.get(stateName);
  },

  setState: async <T>(
    ctx: restate.KeyedContext,
    _workflowId: string,
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

    const stateName = request.stateName;

    // guard against overwriting built-in states
    for (const reservedStateName of RESERVED_STATE_NAMES) {
      if (stateName === reservedStateName) {
        throw new restate.TerminalError(
          "State name is reserved: " + reservedStateName
        );
      }
    }
    for (const reservedStatePrefix of RESERVED_STATE_PREFIXES) {
      if (stateName.startsWith(reservedStatePrefix)) {
        throw new restate.TerminalError(
          "State prefix is reserved: " + reservedStatePrefix
        );
      }
    }

    ctx.set(stateName, request.value);
    await rememberNewStateName(ctx, stateName);
  },

  clearState: async (
    ctx: restate.KeyedContext,
    _workflowId: string,
    stateName: string
  ): Promise<void> => {
    ctx.clear(stateName);
  },

  stateKeys: async (ctx: restate.KeyedContext): Promise<Array<string>> => {
    return (await ctx.get<string[]>(ALL_NAMES_STATE_NAME)) ?? [];
  },

  clearAllState: async (ctx: restate.KeyedContext): Promise<void> => {
    const stateNames = (await ctx.get<string[]>(ALL_NAMES_STATE_NAME)) ?? [];
    for (const stateName of stateNames) {
      ctx.clear(stateName);
    }
  },

  publishMessage: async (
    ctx: restate.KeyedContext,
    _workflowId: string,
    msg: { message: string; timestamp: Date }
  ): Promise<void> => {
    // append message
    const msgs =
      (await ctx.get<StatusMessage[]>(STATUS_MESSAGES_STATE_NAME)) ?? [];
    msgs.push({ sequenceNum: msgs.length, ...msg });
    ctx.set(STATUS_MESSAGES_STATE_NAME, msgs);

    // wake up all listeners
    const listeners = (await ctx.get<string[]>(STATUS_MESSAGE_LISTENERS)) ?? [];
    for (const awkId of listeners) {
      ctx.resolveAwakeable(awkId, {});
    }
    ctx.clear(STATUS_MESSAGE_LISTENERS);
  },

  getLatestMessage: async (
    ctx: restate.KeyedContext
  ): Promise<StatusMessage | null> => {
    const msgs =
      (await ctx.get<StatusMessage[]>(STATUS_MESSAGES_STATE_NAME)) ?? [];
    if (msgs.length === 0) {
      return null;
    } else {
      return msgs[msgs.length - 1];
    }
  },

  pollNextMessages: async (
    ctx: restate.KeyedContext,
    _workflowId: string,
    req: { from: number; awakId: string }
  ): Promise<StatusMessage[] | null> => {
    const msgs =
      (await ctx.get<StatusMessage[]>(STATUS_MESSAGES_STATE_NAME)) ?? [];
    if (msgs.length > req.from) {
      return msgs.slice(req.from);
    }

    // not yet available, register a listener to be woken up when more is available
    const listeners = (await ctx.get<string[]>(STATUS_MESSAGE_LISTENERS)) ?? [];
    listeners.push(req.awakId);
    ctx.set(STATUS_MESSAGE_LISTENERS, listeners);
    return null;
  },

  dispose: async (ctx: restate.KeyedContext): Promise<void> => {
    const stateNames = (await ctx.get<string[]>(ALL_NAMES_STATE_NAME)) ?? [];
    for (const stateName of stateNames) {
      ctx.clear(stateName);
    }
    ctx.clear(ALL_NAMES_STATE_NAME);
    ctx.clear(STATUS_MESSAGE_LISTENERS);
    ctx.clear(STATUS_MESSAGES_STATE_NAME);
    ctx.clear(RESULT_LISTENERS_NAME);
    ctx.clear(RESULT_STATE_NAME);
    ctx.clear(LIFECYCLE_STATUS_STATE_NAME);
  },
});

export type api = typeof workflowStateService;

// ----------------------------------------------------------------------------

async function completePromise<T>(
  ctx: restate.KeyedContext,
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
  await rememberNewStateName(ctx, stateName);

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
  ctx: restate.KeyedContext,
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
  if (listeners.length === 0) {
    await rememberNewStateName(ctx, awakeableStateName);
  }
  listeners.push(awakeableId);
  ctx.set(awakeableStateName, listeners);
  return null;
}

async function peekPromise<T>(
  ctx: restate.KeyedContext,
  stateName: string
): Promise<ValueOrError<T> | null> {
  return ctx.get<ValueOrError<T>>(stateName);
}

async function rememberNewStateName(
  ctx: restate.KeyedContext,
  stateName: string
) {
  const names = (await ctx.get<string[]>(ALL_NAMES_STATE_NAME)) ?? [];
  names.push(stateName);
  ctx.set(ALL_NAMES_STATE_NAME, names);
}

async function checkIfRunning(ctx: restate.KeyedContext): Promise<boolean> {
  const status = await ctx.get<LifecycleStatus>(LIFECYCLE_STATUS_STATE_NAME);
  return status === LifecycleStatus.RUNNING;
}
