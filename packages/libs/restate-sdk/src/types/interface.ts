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
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */

import type {
  Context,
  ObjectContext,
  ObjectSharedContext,
  WorkflowContext,
  WorkflowSharedContext,
} from "../context.js";
import type {
  ServiceDefinition,
  VirtualObjectDefinition,
  WorkflowDefinition,
  Descriptor,
  HandlerDescriptor,
  ServiceDescriptor,
  ObjectDescriptor,
  WorkflowDescriptor,
  InferInput,
  InferOutput,
} from "@restatedev/restate-sdk-core";
import {
  handlers,
  service,
  object,
  workflow,
  type ServiceHandlerOpts,
  type ObjectHandlerOpts,
  type WorkflowHandlerOpts,
  type ServiceOptions,
  type ObjectOptions,
  type WorkflowOptions,
} from "./rpc.js";

// =============================================================================
// implement() — provide handler implementations for a service interface
// (contract) declared with `iface` (see @restatedev/restate-sdk-core), and
// obtain a normal, bindable service/object/workflow definition.
// =============================================================================

/** @internal A handler function whose input argument is dropped when `I` is `void`. */
export type FnOf<C, I, O> = [I] extends [void]
  ? (ctx: C) => Promise<O>
  : (ctx: C, input: I) => Promise<O>;

/** @internal */
export type ServiceImplHandlers<H extends Record<string, HandlerDescriptor>> = {
  [K in keyof H]: FnOf<Context, InferInput<H[K]>, InferOutput<H[K]>>;
};

/** @internal Object handler contexts follow the descriptor's shared flag. */
export type ObjectImplHandlers<H extends Record<string, HandlerDescriptor>> = {
  [K in keyof H]: H[K] extends HandlerDescriptor<any, any, infer Shared>
    ? FnOf<
        Shared extends true ? ObjectSharedContext : ObjectContext,
        InferInput<H[K]>,
        InferOutput<H[K]>
      >
    : never;
};

/** @internal `run` gets a WorkflowContext; every other handler a shared one. */
export type WorkflowImplHandlers<H extends Record<string, HandlerDescriptor>> =
  {
    [K in keyof H]: K extends "run"
      ? FnOf<WorkflowContext, InferInput<H[K]>, InferOutput<H[K]>>
      : FnOf<WorkflowSharedContext, InferInput<H[K]>, InferOutput<H[K]>>;
  };

/** @internal */
export type ServicePerHandlerOpts = Omit<
  ServiceHandlerOpts<unknown, unknown>,
  "input" | "output"
>;
/** @internal */
export type ObjectPerHandlerOpts = Omit<
  ObjectHandlerOpts<unknown, unknown>,
  "input" | "output"
>;
/** @internal */
export type WorkflowPerHandlerOpts = Omit<
  WorkflowHandlerOpts<unknown, unknown>,
  "input" | "output"
>;

export function implement<
  P extends string,
  H extends Record<string, HandlerDescriptor>,
>(
  serviceInterface: ServiceDescriptor<P, H>,
  config: {
    handlers: ServiceImplHandlers<H>;
    description?: string;
    metadata?: Record<string, string>;
    options?: ServiceOptions & {
      handlers?: Partial<Record<keyof H, ServicePerHandlerOpts>>;
    };
  }
): ServiceDefinition<P, ServiceImplHandlers<H>> & ServiceDescriptor<P, H>;

export function implement<
  P extends string,
  H extends Record<string, HandlerDescriptor>,
>(
  objectInterface: ObjectDescriptor<P, H>,
  config: {
    handlers: ObjectImplHandlers<H>;
    description?: string;
    metadata?: Record<string, string>;
    options?: ObjectOptions & {
      handlers?: Partial<Record<keyof H, ObjectPerHandlerOpts>>;
    };
  }
): VirtualObjectDefinition<P, ObjectImplHandlers<H>> & ObjectDescriptor<P, H>;

export function implement<
  P extends string,
  H extends Record<string, HandlerDescriptor>,
>(
  workflowInterface: WorkflowDescriptor<P, H>,
  config: {
    handlers: WorkflowImplHandlers<H>;
    description?: string;
    metadata?: Record<string, string>;
    options?: WorkflowOptions & {
      handlers?: Partial<Record<keyof H, WorkflowPerHandlerOpts>>;
    };
  }
): WorkflowDefinition<P, WorkflowImplHandlers<H>> & WorkflowDescriptor<P, H>;

export function implement(
  contract: Descriptor<any, any, any>,
  config: {
    handlers: Record<string, any>;
    description?: string;
    metadata?: Record<string, string>;
    options?: any;
  }
): any {
  const { handlers: perHandlerOpts, ...serviceOptions } = config.options ?? {};

  const coreHandlers: Record<string, any> = {};
  for (const [name, desc] of Object.entries(
    contract._handlers as Record<string, HandlerDescriptor>
  )) {
    const fn = config.handlers[name];
    if (typeof fn !== "function") {
      throw new Error(`implement(): missing handler "${name}"`);
    }
    const sdkOpts = {
      input: desc._inputSerde,
      output: desc._outputSerde,
      ...((perHandlerOpts?.[name] as object) ?? {}),
    };

    if (contract._kind === "service") {
      coreHandlers[name] = handlers.handler(sdkOpts as any, fn);
    } else if (contract._kind === "object") {
      coreHandlers[name] = desc._shared
        ? handlers.object.shared(sdkOpts as any, fn)
        : handlers.object.exclusive(sdkOpts as any, fn);
    } else {
      coreHandlers[name] =
        name === "run"
          ? handlers.workflow.workflow(sdkOpts as any, fn)
          : handlers.workflow.shared(sdkOpts as any, fn);
    }
  }

  const common = {
    name: contract.name,
    handlers: coreHandlers as any,
    description: config.description,
    metadata: config.metadata,
    options: serviceOptions,
  };

  const def =
    contract._kind === "service"
      ? service(common)
      : contract._kind === "object"
        ? object(common)
        : workflow(common);

  return Object.assign(def, {
    _kind: contract._kind,
    _handlers: contract._handlers,
  });
}
