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

export {
  approveHandler,
  createWorkflowEndpoint,
  restateWorkflow,
  runHandler,
  signalHandler,
} from "./adapter.js";

export type {
  RestateWorkflowApproval,
  RestateWorkflowSignal,
  WorkflowEndpointOptions,
} from "./adapter.js";

// The Restate SDK is bundled into this package and is not a dependency of it,
// so anything that appears in the signatures above has to be re-exported here.
// Without this a consumer could call the API but could not name its types.
export { TerminalError } from "@restatedev/restate-sdk/lite/fetch";

export type {
  FetchEndpointOptions,
  ObjectContext,
  ObjectSharedContext,
  UntypedState,
  VirtualObjectDefinition,
} from "@restatedev/restate-sdk/lite/fetch";
