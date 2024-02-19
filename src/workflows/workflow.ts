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

// ----------------------------------------------------------------------------
//                    workflow definition / registration
// ----------------------------------------------------------------------------

/**
 * Creates a new workflow service that will be served under the given path.
 *
 * A workflow must consist of
 *   - one run method: `run(ctx: WfContext, params: T) => Promise<R>`
 *   - an arbitrary number of interaction methods: `foo(ctx: SharedWfContext, params: X) => Promise<Y>`
 */
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
    api: { path } as restate.ServiceApi<WorkflowRestateRpcApi<R, T, U>>,
    registerServices: (endpoint: restate.ServiceEndpoint) => {
      endpoint.bindKeyedRouter(stateServiceApi.path, stateServiceRouter);
      endpoint.bindRouter(path, wrapperServiceRouter);
    },
  } satisfies WorkflowServices<R, T, U>;
}

/**
 * The type signature of a workflow.
 * A workflow must consist of
 *   - one run method: `run(ctx: WfContext, params: T) => Promise<R>`
 *   - an arbitrary number of interaction methods: `foo(ctx: SharedWfContext, params: T) => Promise<R>`
 */
export type Workflow<R, T, U> = {
  run: RunMethod<R, T>;
} & WorkflowMethods<R, T, U>;

type RunMethod<R, T> = (ctx: WfContext, params: T) => Promise<R>;
type InteractionMethod<R, T> = (ctx: SharedWfContext, params: T) => Promise<R>;

type WorkflowMethods<R, T, U> = {
  [K in keyof U]: K extends "run"
    ? U[K] extends RunMethod<R, T>
      ? U[K]
      : "The 'run' methods needs to follow the signature: (ctx: WfContext, params: any) => Promise<any> "
    : // eslint-disable-next-line @typescript-eslint/no-explicit-any
    U[K] extends InteractionMethod<any, any>
    ? U[K]
    : "Methods other than 'run' are interaction methods and need to follow the signature: (ctx: SharedWfContext, params: any) => Promise<any>";
};

/**
 * The workflow service(s) and API.
 *
 * Register at a Restate endpoint (HTTP/2, Lambda, etc.) as follows:
 * ```
 * const myWorkflow = restate.workflows.workflow("org.acme.myworkflow", {
 * // workflow implementation
 * })
 * restate.createServer().bind(myWorkflow)
 * ```
 *
 * The {@link WorkflowServices.api} can be used to create typed clients, both
 * from other Restate-backed serviced (e.g., `ctx.rpc(api).triggerMySignal()`)
 * or from external clients (`clients.connectWorkflows(restateUri).connectToWorkflow(api, id);`).
 */
export interface WorkflowServices<R, T, U> extends restate.ServiceBundle {
  readonly api: restate.ServiceApi<WorkflowRestateRpcApi<R, T, U>>;
}

// ----------------------------------------------------------------------------
//                workflow-specific types (promises, contexts)
// ----------------------------------------------------------------------------

export type DurablePromise<T> = restate.CombineablePromise<T> & {
  peek(): Promise<T | null>;

  resolve(value?: T): void;
  fail(errorMsg: string): void;
}

/**
 * The context for the workflow's interaction methods, which are all methods
 * other than the 'run()' method.
 *
 * This gives primarily access to state reads and promises.
 */
export interface SharedWfContext {
  workflowId(): string;

  get<T>(stateName: string): Promise<T | null>;

  promise<T = void>(name: string): DurablePromise<T>;
}

/**
 * The context for the workflow's 'run()' function.
 *
 * This is a full context as for stateful durable keyed services, plus the
 * workflow-specific bits, like workflowID and durable promises.
 */
export interface WfContext extends SharedWfContext, restate.KeyedContext {}

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

// ----------------------------------------------------------------------------
//                    types and signatures for typed clients
// ----------------------------------------------------------------------------

/**
 * The type of requests accepted by the workflow service.
 * Must contain the 'workflowId' property.
 */
export type WorkflowRequest<T> = T & { workflowId: string };

/**
 * The API signature of the workflow for use with RPC operations from Restate services.
 */
export type WorkflowRestateRpcApi<R, T, U> = {
  start: (param: WorkflowRequest<T>) => Promise<WorkflowStartResult>;
  waitForResult: (request: WorkflowRequest<unknown>) => Promise<R>;
  status: (request: WorkflowRequest<unknown>) => Promise<LifecycleStatus>;
} & {
  [K in keyof Omit<U, "run">]: U[K] extends InteractionMethod<infer R, infer T>
    ? (request: WorkflowRequest<T>) => Promise<R>
    : never;
};

/**
 * The API signature of the workflow for external clients.
 */
export type WorkflowClientApi<U> = {
  [K in keyof Omit<U, "run">]: U[K] extends (
    ctx: SharedWfContext
  ) => Promise<infer R>
    ? () => Promise<R>
    : U[K] extends (ctx: SharedWfContext, params: infer T) => Promise<infer R>
    ? (request: T) => Promise<R>
    : never;
};
