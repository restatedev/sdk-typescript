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

export type {
  Context,
  ObjectContext,
  ObjectSharedContext,
  WorkflowContext,
  WorkflowSharedContext,
  Rand,
  GenericCall,
  GenericSend,
} from "./context.js";
export { CombineablePromise } from "./context.js";

export type { Serde } from "@restatedev/restate-sdk-core";
export { serde } from "@restatedev/restate-sdk-core";

export type {
  Client,
  SendClient,
  ClientCallOptions,
  ClientSendOptions,
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

export type { ServiceBundle, RestateEndpoint } from "./endpoint.js";
export { RestateError, TerminalError, TimeoutError } from "./types/errors.js";
export type {
  Logger,
  LogParams,
  RestateLogLevel,
  LoggerContext,
  LogSource,
} from "./logger.js";
