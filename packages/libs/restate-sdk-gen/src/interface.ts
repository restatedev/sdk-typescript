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
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment */

import type * as restate from "@restatedev/restate-sdk";
import {
  type HandlerDescriptor,
  type Descriptor,
  type ServiceDescriptor,
  type ObjectDescriptor,
  type WorkflowDescriptor,
  type ImplementedServiceDefinition,
  type ImplementedObjectDefinition,
  type ImplementedWorkflowDefinition,
  type ImplementedDefinition,
  type InferInput,
  type InferOutput,
} from "@restatedev/restate-sdk-core";
import type { Operation } from "./operation.js";
import {
  type GenHandlerOpts,
  type GenObjectHandlerOpts,
  type GenWorkflowHandlerOpts,
  service as _defineService,
  object as _defineObject,
  workflow as _defineWorkflow,
} from "./define.js";

// The pure interface declarators (`json`/`serdes`/`schemas`) and the
// `iface.service/object/workflow` factories now live in
// @restatedev/restate-sdk-core and are re-exported through this package's
// `iface` namespace (see index.ts). InferInput/InferOutput are re-exported for
// API Extractor traceability.
export type { InferInput, InferOutput };

// =============================================================================
// implement() — bind generator handlers to a service interface (contract)
// =============================================================================

/** @internal */
export type ImplementHandlers<H extends Record<string, HandlerDescriptor>> = {
  [K in keyof H]: (input: InferInput<H[K]>) => Operation<InferOutput<H[K]>>;
};

export function implement<
  P extends string,
  H extends Record<string, HandlerDescriptor>,
>(
  iface: ServiceDescriptor<P, H>,
  config: {
    handlers: ImplementHandlers<H>;
    options?: restate.ServiceOptions & {
      handlers?: Partial<Record<keyof H, GenHandlerOpts>>;
    };
  }
): ImplementedServiceDefinition<P, H>;

export function implement<
  P extends string,
  H extends Record<string, HandlerDescriptor>,
>(
  iface: ObjectDescriptor<P, H>,
  config: {
    handlers: ImplementHandlers<H>;
    options?: restate.ObjectOptions & {
      handlers?: Partial<Record<keyof H, GenObjectHandlerOpts>>;
    };
  }
): ImplementedObjectDefinition<P, H>;

export function implement<
  P extends string,
  H extends Record<string, HandlerDescriptor>,
>(
  iface: WorkflowDescriptor<P, H>,
  config: {
    handlers: ImplementHandlers<H>;
    options?: restate.WorkflowOptions & {
      handlers?: Partial<Record<keyof H, GenWorkflowHandlerOpts>>;
    };
  }
): ImplementedWorkflowDefinition<P, H>;

export function implement(
  iface: Descriptor<any, any, any>,
  config: { handlers: Record<string, any>; options?: any }
): ImplementedDefinition<any, any, any> {
  // Build HandlerDef entries from interface descriptors + implementation fns
  const handlerEntries: Record<string, any> = {};
  for (const [name, desc] of Object.entries(
    iface._handlers as Record<string, HandlerDescriptor>
  )) {
    const genFn = config.handlers[name];
    if (!genFn) throw new Error(`implement(): missing handler "${name}"`);
    // Object with _genFn triggers isHandlerDef() check in define.ts factories
    handlerEntries[name] = {
      _genFn: genFn,
      _inputSerde: desc._inputSerde,
      _outputSerde: desc._outputSerde,
    };
  }

  if (iface._kind === "service") {
    return _defineService({
      name: iface.name,
      handlers: handlerEntries,
      options: config.options,
    }) as any;
  } else if (iface._kind === "object") {
    return _defineObject({
      name: iface.name,
      handlers: handlerEntries,
      options: config.options,
    }) as any;
  } else {
    return _defineWorkflow({
      name: iface.name,
      handlers: handlerEntries,
      options: config.options,
    }) as any;
  }
}
