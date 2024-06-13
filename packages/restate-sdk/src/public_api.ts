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

import { RestateEndpoint } from "./endpoint";
import { endpointImpl } from "./endpoint/endpoint_impl";

export {
  Context,
  ObjectContext,
  ObjectSharedContext,
  CombineablePromise,
  WorkflowContext,
  WorkflowSharedContext,
  Rand,
} from "./context";

export type { Client, SendClient } from "./types/rpc";
export { service, object, workflow, handlers } from "./types/rpc";

export type {
  ServiceDefinition,
  VirtualObjectDefinition,
  WorkflowDefinition,
} from "@restatedev/restate-sdk-core";

export { ServiceBundle, RestateEndpoint } from "./endpoint";
export { RestateError, TerminalError, TimeoutError } from "./types/errors";

/**
 * Create a new {@link RestateEndpoint}.
 */
export function endpoint(): RestateEndpoint {
  return endpointImpl();
}
