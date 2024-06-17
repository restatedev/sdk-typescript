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
} from "@restatedev/restate-sdk-core";

export type {
  Ingress,
  ConnectionOpts,
  IngressClient,
  IngressSendClient,
  IngressWorkflowClient,
  IngresCallOptions,
  Send,
  IngresSendOptions,
} from "./api";

export { Opts, SendOpts } from "./api";

export { connect } from "./ingress";
