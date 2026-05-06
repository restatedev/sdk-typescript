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
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unnecessary-type-assertion */

import type * as restate from "@restatedev/restate-sdk";
import type { StandardSchemaV1 } from "@restatedev/restate-sdk-core";
import type { Operation } from "./operation.js";
import {
  type HandlerDescriptor,
  type Descriptor,
  type ImplementedDefinition,
  type GenHandlerOpts,
  type GenObjectHandlerOpts,
  type GenWorkflowHandlerOpts,
  makeDescriptor,
  toSerde,
  service as _defineService,
  object as _defineObject,
  workflow as _defineWorkflow,
  ObjectDescriptor,
  WorkflowDescriptor,
  ServiceDescriptor,
  ImplementedServiceDefinition,
  ImplementedObjectDefinition,
  ImplementedWorkflowDefinition,
} from "./define.js";

// =============================================================================
// restate.interface descriptor helpers — no fn, type info only
// =============================================================================

/** json<I, O>() — type params, default JSON serde */
export function json<I = void, O = void>(): HandlerDescriptor<I, O> {
  return makeDescriptor<I, O>(undefined, undefined);
}

/** serdes(opts) — explicit Serde per field */
export function serdes<
  SI extends restate.Serde<any>,
  SO extends restate.Serde<any>,
>(opts: {
  input?: SI;
  output?: SO;
}): HandlerDescriptor<
  SI extends restate.Serde<infer I> ? I : never,
  SO extends restate.Serde<infer O> ? O : never
> {
  return makeDescriptor(opts.input, opts.output) as HandlerDescriptor<any, any>;
}

/** schemas(opts) — Standard Schema (Zod, TypeBox, Valibot, …) per field */
export function schemas<
  SI extends StandardSchemaV1<any>,
  SO extends StandardSchemaV1<any>,
>(opts: {
  input?: SI;
  output?: SO;
}): HandlerDescriptor<
  StandardSchemaV1.InferOutput<NonNullable<SI>>,
  StandardSchemaV1.InferOutput<NonNullable<SO>>
> {
  return makeDescriptor(
    opts.input ? toSerde(opts.input) : undefined,
    opts.output ? toSerde(opts.output) : undefined
  ) as HandlerDescriptor<any, any>;
}

// =============================================================================
// restate.interface.service / object / workflow
// =============================================================================

export function service<
  P extends string,
  H extends Record<string, HandlerDescriptor>,
>(name: P, handlers: H): ServiceDescriptor<P, H> {
  return { name, _kind: "service", _handlers: handlers };
}

export function object<
  P extends string,
  H extends Record<string, HandlerDescriptor>,
>(name: P, handlers: H): ObjectDescriptor<P, H> {
  return { name, _kind: "object", _handlers: handlers };
}

export function workflow<
  P extends string,
  H extends Record<string, HandlerDescriptor>,
>(name: P, handlers: H): WorkflowDescriptor<P, H> {
  return { name, _kind: "workflow", _handlers: handlers };
}

// =============================================================================
// implement() — standalone free function
// =============================================================================

/** @internal */
export type InferInput<D> = D extends HandlerDescriptor<infer I, any> ? I : any;
/** @internal */
export type InferOutput<D> =
  D extends HandlerDescriptor<any, infer O> ? O : any;

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
