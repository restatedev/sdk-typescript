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
  RestateContext,
  ServiceHandler,
  ServiceDefinition,
  Service,
  ServiceDefinitionFrom,
  RestateObjectContext,
  RestateObjectSharedContext,
  ObjectHandler,
  ObjectSharedHandler,
  VirtualObject,
  VirtualObjectDefinition,
  VirtualObjectDefinitionFrom,
  WorkflowDefinition,
  WorkflowHandler,
  WorkflowSharedHandler,
  RestateWorkflowContext,
  RestateWorkflowSharedContext,
  Workflow,
  WorkflowDefinitionFrom,
  ArgType,
  HandlerReturnType,
} from "./core.js";

export type { Serde } from "./serde_api.js";
export { serde } from "./serde_api.js";

export type { Duration } from "./duration.js";
export { durationToMillis, millisOrDurationToMillis } from "./duration.js";

export type { JournalValueCodec } from "./entry_codec.js";

export type {
  StandardTypedV1,
  StandardSchemaV1,
  StandardJSONSchemaV1,
} from "./standard_schema.js";
