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

import { RestatePromise } from "./context.js";

export type {
  Context,
  ObjectContext,
  ObjectSharedContext,
  WorkflowContext,
  WorkflowSharedContext,
  Rand,
  GenericCall,
  GenericSend,
  InvocationId,
  InvocationHandle,
  InvocationPromise,
  TypedState,
  UntypedState,
  ContextDate,
  RunAction,
  RunOptions,
  SendOptions,
  KeyValueStore,
  DurablePromise,
  Request,
} from "./context.js";
export { InvocationIdParser, RestatePromise } from "./context.js";

/**
 * @deprecated Use {@link RestatePromise}
 */
export const CombineablePromise = RestatePromise;

/**
 * @deprecated Use {@link RestatePromise}
 */
export type CombineablePromise<T> = RestatePromise<T>;

export type {
  Serde,
  RestateContext,
  ServiceDefinitionFrom,
  Service,
  VirtualObjectDefinitionFrom,
  VirtualObject,
  WorkflowDefinitionFrom,
  Workflow,
  RestateObjectContext,
  RestateObjectSharedContext,
  RestateWorkflowSharedContext,
  RestateWorkflowContext,
  ServiceHandler,
  ObjectHandler,
  WorkflowHandler,
  WorkflowSharedHandler,
  Duration,
} from "@restatedev/restate-sdk-core";
export { serde } from "@restatedev/restate-sdk-core";

export type {
  Client,
  SendClient,
  ClientCallOptions,
  ClientSendOptions,
  RemoveVoidArgument,
  InferArg,
  ServiceHandlerOpts,
  WorkflowHandlerOpts,
  ObjectHandlerOpts,
  ServiceOpts,
  ObjectOpts,
  WorkflowOpts,
  ServiceOptions,
  ObjectOptions,
  WorkflowOptions,
  StateDefinition,
} from "./types/rpc.js";
export {
  service,
  object,
  workflow,
  handlers,
  Opts,
  SendOpts,
  state,
} from "./types/rpc.js";

export { rpc } from "./types/rpc.js";

export type {
  ServiceDefinition,
  VirtualObjectDefinition,
  WorkflowDefinition,
} from "@restatedev/restate-sdk-core";

export type {
  RestateEndpoint,
  RestateEndpointBase,
  DefaultServiceOptions,
} from "./endpoint.js";

export {
  /**
   * @deprecated YOU MUST NOT USE THIS TYPE
   */
  RestateError,
  TerminalError,
  TimeoutError,
  RetryableError,
  type RetryableErrorOptions,
} from "./types/errors.js";
export type {
  LoggerTransport,
  LogMetadata,
  RestateLogLevel,
  LoggerContext,
  LogSource,
} from "./logging/logger_transport.js";
export type { EndpointOptions } from "./endpoint/types.js";

// re-exporting createHandler shortcuts

import { handlers } from "./types/rpc.js";

export const createServiceHandler = handlers.handler;
export const createObjectHandler = handlers.object.exclusive;
export const createObjectSharedHandler = handlers.object.shared;
export const createWorkflowHandler = handlers.workflow.workflow;
export const createWorkflowSharedHandler = handlers.workflow.shared;
