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
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion */

import * as restate from "@restatedev/restate-sdk";
import type { StandardSchemaV1 } from "@restatedev/restate-sdk-core";
import { execute } from "./restate-operations.js";
import { type Operation } from "./operation.js";

// =============================================================================
// Shared types (consumed here and by interface.ts)
// =============================================================================

// --- HandlerDescriptor -------------------------------------------------------

/**
 * Minimal descriptor stored in Descriptor._handlers per handler.
 */
export type HandlerDescriptor<I = any, O = any> = {
  readonly _inputSerde?: restate.Serde<I>;
  readonly _outputSerde?: restate.Serde<O>;
};

export function makeDescriptor<I, O>(
  inputSerde?: restate.Serde<I>,
  outputSerde?: restate.Serde<O>
): HandlerDescriptor<I, O> {
  return {
    _inputSerde: inputSerde,
    _outputSerde: outputSerde,
  };
}

// --- Descriptor -----------------------------------------------------

/**
 * The single client-facing type for all definition styles.
 * - Returned by service() / object() / workflow() (also bindable to serve())
 * - Returned by restate.interface.service/object/workflow (pure, not bindable)
 * - Returned by implement() (also bindable)
 */
export type Descriptor<
  P extends string = string,
  H extends Record<string, HandlerDescriptor> = Record<
    string,
    HandlerDescriptor
  >,
  Kind extends "service" | "object" | "workflow" =
    | "service"
    | "object"
    | "workflow",
> = {
  readonly name: P;
  readonly _kind: Kind;
  readonly _handlers: H;
};

/** Kind-specific aliases for the common Descriptor type */
export type ServiceDescriptor<
  P extends string = string,
  H extends Record<string, HandlerDescriptor> = Record<
    string,
    HandlerDescriptor
  >,
> = Descriptor<P, H, "service">;

export type ObjectDescriptor<
  P extends string = string,
  H extends Record<string, HandlerDescriptor> = Record<
    string,
    HandlerDescriptor
  >,
> = Descriptor<P, H, "object">;

export type WorkflowDescriptor<
  P extends string = string,
  H extends Record<string, HandlerDescriptor> = Record<
    string,
    HandlerDescriptor
  >,
> = Descriptor<P, H, "workflow">;

/** Implemented definition — extends Descriptor and also bindable to serve() */
export type ImplementedServiceDefinition<
  P extends string,
  H extends Record<string, HandlerDescriptor>,
> = restate.ServiceDefinition<P, any> & ServiceDescriptor<P, H>;

export type ImplementedObjectDefinition<
  P extends string,
  H extends Record<string, HandlerDescriptor>,
> = restate.VirtualObjectDefinition<P, any> & ObjectDescriptor<P, H>;

export type ImplementedWorkflowDefinition<
  P extends string,
  H extends Record<string, HandlerDescriptor>,
> = restate.WorkflowDefinition<P, any> & WorkflowDescriptor<P, H>;

export type ImplementedDefinition<
  P extends string,
  H extends Record<string, HandlerDescriptor>,
  Kind extends "service" | "object" | "workflow",
> = Kind extends "service"
  ? ImplementedServiceDefinition<P, H>
  : Kind extends "object"
    ? ImplementedObjectDefinition<P, H>
    : ImplementedWorkflowDefinition<P, H>;

// =============================================================================
// HandlerDef — result of typed()
// =============================================================================

/** @internal
 * @internal - Wraps a generator function with optional serde. Produced by typed().
 * Discriminated by _genFn for runtime detection (distinct from bare gen fns,
 * which are plain functions rather than objects).
 */
export type HandlerDef<I = any, O = any> = {
  readonly _genFn: (input: I) => Operation<O>;
} & HandlerDescriptor<I, O>;

/** @internal */
export type EntryToDescriptor<E> =
  E extends HandlerDef<infer I, infer O>
    ? HandlerDescriptor<I, O>
    : E extends () => Operation<infer O>
      ? HandlerDescriptor<void, O> // no-arg generator → void input
      : E extends (input: infer I) => Operation<infer O>
        ? HandlerDescriptor<I, O>
        : HandlerDescriptor;

/** Map a full handler map type to the corresponding descriptor map type */
export type HandlerDescriptors<
  H extends Record<string, HandlerOrHandlerDescriptor>,
> = {
  [K in keyof H]: EntryToDescriptor<H[K]>;
};

// =============================================================================
// Per-handler options
// =============================================================================

/** Options valid for all handler types (no serde — those live in typed()) */
export type GenHandlerOpts = {
  idempotencyRetention?: restate.Duration | number;
  journalRetention?: restate.Duration | number;
  inactivityTimeout?: restate.Duration | number;
  abortTimeout?: restate.Duration | number;
  retryPolicy?: restate.RetryPolicy;
  description?: string;
  metadata?: Record<string, string>;
  ingressPrivate?: boolean;
  explicitCancellation?: boolean;
};

/** Handler options for virtual object handlers */
export type GenObjectHandlerOpts = GenHandlerOpts & {
  shared?: boolean;
  enableLazyState?: boolean;
};

/** Handler options for workflow handlers (shared is implicit from name) */
export type GenWorkflowHandlerOpts = {
  enableLazyState?: boolean;
};

// =============================================================================
// Handler entry types
// =============================================================================

/** @internal */
export type AnyGenFn = (input: any) => Operation<any>;

/** A handler entry: either a bare generator fn or the result of typed() */
export type HandlerOrHandlerDescriptor = AnyGenFn | HandlerDef<any, any>;

// =============================================================================
// Helpers
// =============================================================================

/** HandlerDef has _genFn as an object property; bare gen fns are plain functions */
function isHandlerDef(
  entry: HandlerOrHandlerDescriptor
): entry is HandlerDef<any, any> {
  return (
    typeof entry === "object" &&
    entry !== null &&
    typeof (entry as any)._genFn === "function"
  );
}

/** Convert a Standard Schema to a Serde via restate.serde.schema() */
export function toSerde<T>(schema: StandardSchemaV1<T>): restate.Serde<T> {
  return restate.serde.schema(schema as any) as restate.Serde<T>;
}

function extractEntry(entry: HandlerOrHandlerDescriptor): {
  genFn: AnyGenFn;
  inputSerde: restate.Serde<any> | undefined;
  outputSerde: restate.Serde<any> | undefined;
} {
  if (isHandlerDef(entry)) {
    return {
      genFn: entry._genFn as AnyGenFn,
      inputSerde: entry._inputSerde,
      outputSerde: entry._outputSerde,
    };
  }
  return {
    genFn: entry as AnyGenFn,
    inputSerde: undefined,
    outputSerde: undefined,
  };
}

// =============================================================================
// Handler definition helpers — produce HandlerDef for use in service/object/workflow
// =============================================================================

/** serdes(opts, fn) — explicit Serde per field */
export function serdes<I, O>(
  opts: { input: restate.Serde<I>; output: restate.Serde<O> },
  fn: (input: I) => Operation<O>
): HandlerDef<I, O> {
  return {
    _genFn: fn as AnyGenFn,
    _inputSerde: opts.input,
    _outputSerde: opts.output,
  };
}

/** schemas(opts, fn) — Standard Schema (Zod, TypeBox, Valibot, …) per field */
export function schemas<
  SI extends StandardSchemaV1<any>,
  SO extends StandardSchemaV1<any>,
>(
  opts: { input: SI; output: SO },
  fn: (
    input: StandardSchemaV1.InferOutput<SI>
  ) => Operation<StandardSchemaV1.InferOutput<SO>>
): HandlerDef<
  StandardSchemaV1.InferOutput<SI>,
  StandardSchemaV1.InferOutput<SO>
> {
  return {
    _genFn: fn as AnyGenFn,
    _inputSerde: toSerde(opts.input),
    _outputSerde: toSerde(opts.output),
  };
}

// =============================================================================
// service() factory
// =============================================================================

export function service<
  P extends string,
  H extends Record<string, HandlerOrHandlerDescriptor>,
>(config: {
  name: P;
  description?: string;
  metadata?: Record<string, string>;
  handlers: H;
  options?: restate.ServiceOptions & {
    handlers?: Partial<Record<keyof H, GenHandlerOpts>>;
  };
}): ImplementedServiceDefinition<P, HandlerDescriptors<H>> {
  const { name, description, metadata, handlers, options } = config;
  const { handlers: perHandlerOpts, ...serviceOpts } = options ?? {};

  const coreHandlers: Record<string, any> = {};
  const descriptors: Record<string, HandlerDescriptor> = {};

  for (const [handlerName, entry] of Object.entries(handlers)) {
    const { genFn, inputSerde, outputSerde } = extractEntry(entry);
    const handlerOpts = (perHandlerOpts as any)?.[handlerName] ?? {};

    coreHandlers[handlerName] = restate.handlers.handler(
      { input: inputSerde, output: outputSerde, ...handlerOpts } as any,
      async (ctx: restate.Context, input: any) => execute(ctx, genFn(input))
    );

    descriptors[handlerName] = makeDescriptor(inputSerde, outputSerde);
  }

  const coreDef = restate.service({
    name,
    handlers: coreHandlers as any,
    description,
    metadata,
    options: serviceOpts,
  });

  return Object.assign(coreDef, {
    _kind: "service" as const,
    _handlers: descriptors,
  }) as unknown as ImplementedServiceDefinition<P, HandlerDescriptors<H>>;
}

// =============================================================================
// object() factory
// =============================================================================

export function object<
  P extends string,
  H extends Record<string, HandlerOrHandlerDescriptor>,
>(config: {
  name: P;
  description?: string;
  metadata?: Record<string, string>;
  handlers: H;
  options?: restate.ObjectOptions & {
    handlers?: Partial<Record<keyof H, GenObjectHandlerOpts>>;
  };
}): ImplementedObjectDefinition<P, HandlerDescriptors<H>> {
  const { name, description, metadata, handlers, options } = config;
  const { handlers: perHandlerOpts, ...objectOpts } = options ?? {};

  const coreHandlers: Record<string, any> = {};
  const descriptors: Record<string, HandlerDescriptor> = {};

  for (const [handlerName, entry] of Object.entries(handlers)) {
    const { genFn, inputSerde, outputSerde } = extractEntry(entry);
    const handlerOpts: GenObjectHandlerOpts =
      (perHandlerOpts as any)?.[handlerName] ?? {};
    const { shared, ...restOpts } = handlerOpts;

    const sdkOpts = {
      input: inputSerde,
      output: outputSerde,
      ...restOpts,
    } as any;
    const fn = async (
      ctx: restate.ObjectContext | restate.ObjectSharedContext,
      input: any
    ) => execute(ctx as restate.Context, genFn(input));

    coreHandlers[handlerName] = shared
      ? restate.handlers.object.shared(sdkOpts, fn as any)
      : restate.handlers.object.exclusive(sdkOpts, fn as any);

    descriptors[handlerName] = makeDescriptor(inputSerde, outputSerde);
  }

  const coreDef = restate.object({
    name,
    handlers: coreHandlers as any,
    description,
    metadata,
    options: objectOpts,
  });

  return Object.assign(coreDef, {
    _kind: "object" as const,
    _handlers: descriptors,
  }) as unknown as ImplementedObjectDefinition<P, HandlerDescriptors<H>>;
}

// =============================================================================
// workflow() factory
// =============================================================================

export function workflow<
  P extends string,
  H extends Record<string, HandlerOrHandlerDescriptor>,
>(config: {
  name: P;
  description?: string;
  metadata?: Record<string, string>;
  handlers: H;
  options?: restate.WorkflowOptions & {
    handlers?: Partial<Record<keyof H, GenWorkflowHandlerOpts>>;
  };
}): ImplementedWorkflowDefinition<P, HandlerDescriptors<H>> {
  const { name, description, metadata, handlers, options } = config;
  const { handlers: perHandlerOpts, ...workflowOpts } = options ?? {};

  const coreHandlers: Record<string, any> = {};
  const descriptors: Record<string, HandlerDescriptor> = {};

  for (const [handlerName, entry] of Object.entries(handlers)) {
    const { genFn, inputSerde, outputSerde } = extractEntry(entry);
    const handlerOpts = (perHandlerOpts as any)?.[handlerName] ?? {};

    const sdkOpts = {
      input: inputSerde,
      output: outputSerde,
      ...handlerOpts,
    } as any;
    const fn = async (
      ctx: restate.WorkflowContext | restate.WorkflowSharedContext,
      input: any
    ) => execute(ctx as restate.Context, genFn(input));

    coreHandlers[handlerName] =
      handlerName === "run"
        ? restate.handlers.workflow.workflow(sdkOpts, fn as any)
        : restate.handlers.workflow.shared(sdkOpts, fn as any);

    descriptors[handlerName] = makeDescriptor(inputSerde, outputSerde);
  }

  const coreDef = restate.workflow({
    name,
    handlers: coreHandlers as any,
    description,
    metadata,
    options: workflowOpts,
  });

  return Object.assign(coreDef, {
    _kind: "workflow" as const,
    _handlers: descriptors,
  }) as unknown as ImplementedWorkflowDefinition<P, HandlerDescriptors<H>>;
}
