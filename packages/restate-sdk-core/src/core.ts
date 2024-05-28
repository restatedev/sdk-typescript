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

export type ServiceDefinition<P extends string, M> = {
  name: P;
  service?: M;
};

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

export type VirtualObjectDefinition<P extends string, M> = {
  name: P;
  object?: M;
};

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

export type WorkflowDefinition<P extends string, M> = {
  name: P;
  workflow?: M;
};
