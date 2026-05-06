/*
 * Copyright (c) 2023-2026 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

// Public API.

export type { Channel } from "./channel.js";
export type { GenClient, GenSendClient, ClientFuture } from "./clients.js";
export type { GenDurablePromise } from "./durable-promise.js";
export type {
  InvocationReference,
  SignalReference,
} from "./invocation-reference.js";
export {
  all,
  allSettled,
  any,
  attach,
  awakeable,
  call,
  cancel,
  channel,
  client,
  handlerRequest,
  invocation,
  race,
  rejectAwakeable,
  resolveAwakeable,
  run,
  send,
  sendClient,
  sharedState,
  signal,
  sleep,
  state,
  workflowPromise,
} from "./free.js";

export type {
  Future,
  FutureFulfilledResult,
  FutureRejectedResult,
  FutureSettledResult,
  FutureValue,
  FutureValues,
} from "./future.js";
export {
  gen,
  type Operation,
  select,
  type SelectResult,
  spawn,
} from "./operation.js";
export {
  type RetryOptions,
  type RunAction,
  type RunActionOpts,
  type RunOpts,
  wrapActionForCancellation,
} from "./restate-operations.js";
export type { SharedState, State, TypedState, UntypedState } from "./state.js";

// Service/object/workflow definition API
export {
  serdes,
  schemas,
  service,
  object,
  workflow,
  type Descriptor,
  type HandlerDescriptor,
  type HandlerOrHandlerDescriptor,
  type HandlerDescriptors,
  type ServiceDescriptor,
  type ObjectDescriptor,
  type WorkflowDescriptor,
  type ImplementedServiceDefinition,
  type ImplementedObjectDefinition,
  type ImplementedWorkflowDefinition,
  type ImplementedDefinition,
  type GenHandlerOpts,
  type GenObjectHandlerOpts,
  type GenWorkflowHandlerOpts,
} from "./define.js";

// Interface / implement pattern
export { implement } from "./interface.js";
import * as _iface from "./interface.js";
export { _iface as iface };

// Ingress adapters, exported as `clients` namespace
import * as _ingress from "./ingress.js";
export { _ingress as clients };

// External types that appear in our public API surface — re-exported for consumers
export { serde } from "@restatedev/restate-sdk-core";
export type {
  StandardSchemaV1,
  Serde,
  VirtualObjectDefinitionFrom,
  VirtualObject,
  Service,
  ServiceDefinition,
  ServiceDefinitionFrom,
  Workflow,
  WorkflowDefinition,
  WorkflowDefinitionFrom,
  VirtualObjectDefinition,
  Duration,
  StandardTypedV1,
} from "@restatedev/restate-sdk-core";

// Internal types exposed only for API Extractor traceability — not part of the public API
/** @internal */
export type { EntryToDescriptor, AnyGenFn, HandlerDef } from "./define.js";
/** @internal */
export type {
  ImplementHandlers,
  InferInput,
  InferOutput,
} from "./interface.js";
