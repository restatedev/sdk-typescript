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
  ServiceDefinition,
  VirtualObjectDefinition,
  WorkflowDefinition,
  ServiceDefinitionFrom,
  VirtualObjectDefinitionFrom,
  WorkflowDefinitionFrom,
  Serde,
  Service,
  Workflow,
  VirtualObject,
  Duration,
  JournalValueCodec,
} from "@restatedev/restate-sdk-core";

export { serde } from "@restatedev/restate-sdk-core";

export type {
  Ingress,
  ConnectionOpts,
  IngressClient,
  IngressSendClient,
  IngressWorkflowClient,
  IngressCallOptions,
  Send,
  IngressSendOptions,
  WorkflowSubmission,
  InferArgType,
  Output,
} from "./api.js";
export { Opts, SendOpts } from "./api.js";

export { rpc } from "./api.js";

export { connect, HttpCallError } from "./ingress.js";
