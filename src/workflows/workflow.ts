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
import * as wws from "./workflow_wrapper_service";
import * as wss from "./workflow_state_service";

const STATE_SERVICE_PATH_SUFFIX = "_state";

export interface DurablePromise<T> {
  promise(): Promise<T>;
  peek(): Promise<T | null>;

  resolve(value?: T): void;
  fail(errorMsg: string): void;
}

export interface SharedWfContext {
  workflowId(): string;

  get<T>(stateName: string): Promise<T | null>;

  promise<T = void>(name: string): DurablePromise<T>;
}

export interface WfContext extends SharedWfContext, restate.RpcContext {
  // publishMessage(message: string): void;
}

export enum LifecycleStatus {
  NOT_STARTED = "NOT_STARTED",
  RUNNING = "RUNNING",
  FINISHED = "FINISHED",
  FAILED = "FAILED",
}

export enum WorkflowStartResult {
  STARTED = "STARTED",
  ALREADY_STARTED = "ALREADY_STARTED",
  ALREADY_FINISHED = "ALREADY_FINISHED",
}

export type StatusMessage = {
  sequenceNum: number;
  message: string;
  timestamp: Date;
};

export type WorkflowRequest<T> = T & { workflowId: string };

type RunMethodSignature<R, T> = (ctx: WfContext, params: T) => Promise<R>;
type InteractionMethodSignature<R, T> = (
  ctx: SharedWfContext,
  params: T
) => Promise<R>;

type WorkflowMethodsSignatures<R, T, U> = {
  [K in keyof U]: K extends "run"
    ? U[K] extends RunMethodSignature<R, T>
      ? U[K]
      : "The 'run' methods needs to follow the signature: (ctx: WfContext, params: any) => Promise<any> "
    : // eslint-disable-next-line @typescript-eslint/no-explicit-any
    U[K] extends InteractionMethodSignature<any, any>
    ? U[K]
    : "Methods other than 'run' are interaction methods and need to follow the signature: (ctx: SharedWfContext, params: any) => Promise<any>";
};

export type Workflow<R, T, U> = {
  run: RunMethodSignature<R, T>;
} & WorkflowMethodsSignatures<R, T, U>;

export type WorkflowExternalSignature<R, T, U> = {
  start: (param: WorkflowRequest<T>) => Promise<WorkflowStartResult>;
  waitForResult: (request: WorkflowRequest<unknown>) => Promise<R>;
} & Omit<
  {
    [K in keyof U]: U[K] extends InteractionMethodSignature<infer R, infer T>
      ? (request: WorkflowRequest<T>) => Promise<R>
      : never;
  },
  "run"
>;

export type WorkflowConnectedSignature<U> = Omit<
  {
    [K in keyof U]: U[K] extends (ctx: SharedWfContext) => Promise<infer R>
      ? () => Promise<R>
      : U[K] extends (ctx: SharedWfContext, params: infer T) => Promise<infer R>
      ? (request: T) => Promise<R>
      : never;
  },
  "run"
>;

export interface WorkflowServices<R, T, U> extends restate.ServiceBundle {
  readonly api: restate.ServiceApi<WorkflowExternalSignature<R, T, U>>;
}

export function workflow<R, T, U>(
  path: string,
  workflow: Workflow<R, T, U>
): WorkflowServices<R, T, U> {
  // the state service manages all state and promises for us
  const stateServiceRouter = wss.workflowStateService;
  const stateServiceApi: restate.ServiceApi<wss.api> = {
    path: path + STATE_SERVICE_PATH_SUFFIX,
  };

  // the wrapper service manages life cycle, contexts, delegation to the state service
  const wrapperServiceRouter = wws.createWrapperService(
    workflow,
    path,
    stateServiceApi
  );

  return {
    api: { path } as restate.ServiceApi<WorkflowExternalSignature<R, T, U>>,
    registerServices: (endpoint: restate.ServiceEndpoint) => {
      endpoint.bindKeyedRouter(stateServiceApi.path, stateServiceRouter);
      endpoint.bindRouter(path, wrapperServiceRouter);
    },
  } satisfies WorkflowServices<R, T, U>;
}
