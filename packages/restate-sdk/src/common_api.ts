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

export type { Serde } from "@restatedev/restate-sdk-core";
export { serde } from "@restatedev/restate-sdk-core";

export type {
  Client,
  SendClient,
  ClientCallOptions,
  ClientSendOptions,
  RemoveVoidArgument,
} from "./types/rpc.js";
export {
  service,
  object,
  workflow,
  handlers,
  Opts,
  SendOpts,
} from "./types/rpc.js";

export { rpc } from "./types/rpc.js";

export type {
  ServiceDefinition,
  VirtualObjectDefinition,
  WorkflowDefinition,
} from "@restatedev/restate-sdk-core";

export type { RestateEndpoint } from "./endpoint.js";
export { RestateError, TerminalError, TimeoutError } from "./types/errors.js";
export type {
  LoggerTransport,
  LogMetadata,
  RestateLogLevel,
  LoggerContext,
  LogSource,
} from "./logging/logger_transport.js";
