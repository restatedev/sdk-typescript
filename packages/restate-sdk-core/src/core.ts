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

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable @typescript-eslint/no-empty-interface */

// ----------- markers -------------------------------------------------------

export interface RestateContext {}
export interface RestateObjectContext {}
export interface RestateObjectSharedContext {}

// workflow
export interface RestateWorkflowSharedContext
  extends RestateObjectSharedContext {}
export interface RestateWorkflowContext
  extends RestateObjectContext,
    RestateWorkflowSharedContext {}

// ----------- service -------------------------------------------------------

export type ServiceHandler<F, C = RestateContext> = F extends (
  ctx: C
) => Promise<any>
  ? F
  : F extends (ctx: C, input: any) => Promise<any>
  ? F
  : never;

/* eslint-disable-next-line @typescript-eslint/no-unused-vars */
export type ServiceDefinition<P extends string, M> = {
  name: P;
};

export type Service<M> = M extends ServiceDefinition<string, infer S> ? S : M;
export type ServiceDefinitionFrom<M> = M extends ServiceDefinition<
  string,
  unknown
>
  ? M
  : ServiceDefinition<string, M>;

// ----------- object -------------------------------------------------------

export type ObjectSharedHandler<
  F,
  SC = RestateObjectSharedContext
> = F extends (ctx: SC, param: any) => Promise<any>
  ? F
  : F extends (ctx: SC) => Promise<any>
  ? F
  : never;

export type ObjectHandler<F, C = RestateObjectContext> = F extends (
  ctx: C,
  param: any
) => Promise<any>
  ? F
  : F extends (ctx: C) => Promise<any>
  ? F
  : never;

/* eslint-disable-next-line @typescript-eslint/no-unused-vars */
export type VirtualObjectDefinition<P extends string, M> = {
  name: P;
};

export type VirtualObject<M> = M extends VirtualObjectDefinition<
  string,
  infer O
>
  ? O
  : never;

export type VirtualObjectDefinitionFrom<M> = M extends VirtualObjectDefinition<
  string,
  unknown
>
  ? M
  : VirtualObjectDefinition<string, M>;

// ----------- workflow -------------------------------------------------------

export type WorkflowSharedHandler<
  F,
  SC = RestateWorkflowSharedContext
> = F extends (ctx: SC, param: any) => Promise<any>
  ? F
  : F extends (ctx: SC) => Promise<any>
  ? F
  : never;

export type WorkflowHandler<F, C = RestateWorkflowContext> = F extends (
  ctx: C,
  param: any
) => Promise<any>
  ? F
  : F extends (ctx: C) => Promise<any>
  ? F
  : never;

/* eslint-disable-next-line @typescript-eslint/no-unused-vars */
export type WorkflowDefinition<P extends string, M> = {
  name: P;
};

export type Workflow<M> = M extends WorkflowDefinition<string, infer W> ? W : M;

export type WorkflowDefinitionFrom<M> = M extends WorkflowDefinition<
  string,
  unknown
>
  ? M
  : WorkflowDefinition<string, M>;
