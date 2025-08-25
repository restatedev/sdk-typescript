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

/**
 * @deprecated
 */
export type ArgType<T> = T extends (ctx: any) => any
  ? void
  : T extends (ctx: any, input: infer I) => any
  ? I
  : never;

/**
 * @deprecated
 */
export type HandlerReturnType<T> = T extends (
  ctx: any,
  input: any
) => Promise<infer R>
  ? R
  : never;

/**
 * @deprecated
 */
export type ServiceHandler<F, C = RestateContext> = F extends (
  ctx: C
) => Promise<any>
  ? F
  : F extends (ctx: C, input: any) => Promise<any>
  ? F
  : (ctx: C, input?: any) => Promise<any>;

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

/**
 * @deprecated
 */
export type ObjectSharedHandler<
  F,
  SC = RestateObjectSharedContext
> = F extends (ctx: SC, param: any) => Promise<any>
  ? F
  : F extends (ctx: SC) => Promise<any>
  ? F
  : (ctx: SC, param?: any) => Promise<any>;

/**
 * @deprecated
 */
export type ObjectHandler<F, C = RestateObjectContext> = F extends (
  ctx: C,
  param: any
) => Promise<any>
  ? F
  : F extends (ctx: C) => Promise<any>
  ? F
  : (ctx: C, param?: any) => Promise<any>;

/* eslint-disable-next-line @typescript-eslint/no-unused-vars */
export type VirtualObjectDefinition<P extends string, M> = {
  name: P;
};

export type VirtualObject<M> = M extends VirtualObjectDefinition<
  string,
  infer O
>
  ? O
  : M;

export type VirtualObjectDefinitionFrom<M> = M extends VirtualObjectDefinition<
  string,
  unknown
>
  ? M
  : VirtualObjectDefinition<string, M>;

// ----------- workflow -------------------------------------------------------

/**
 * @deprecated
 */
export type WorkflowSharedHandler<
  F,
  SC = RestateWorkflowSharedContext
> = F extends (ctx: SC, param: any) => Promise<any>
  ? F
  : F extends (ctx: SC) => Promise<any>
  ? F
  : (ctx: SC, param?: any) => Promise<any>;

/**
 * @deprecated
 */
export type WorkflowHandler<F, C = RestateWorkflowContext> = F extends (
  ctx: C,
  param: any
) => Promise<any>
  ? F
  : F extends (ctx: C) => Promise<any>
  ? F
  : (ctx: C, param?: any) => Promise<any>;

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

// -------- Type manipulation for clients

export type FlattenHandlersDefinition<M> = {
  [K in keyof M]: M[K] extends {
    handler:
      | ((ctx: any, param: any) => Promise<any>)
      | ((ctx: any) => Promise<any>)
      | ((ctx: any, param?: any) => Promise<any>);
  }
    ? M[K]["handler"]
    : M[K] extends {
        sharedHandler:
          | ((ctx: any, param: any) => Promise<any>)
          | ((ctx: any) => Promise<any>)
          | ((ctx: any, param?: any) => Promise<any>);
      }
    ? M[K]["sharedHandler"]
    : M[K] extends
        | ((ctx: any, param: any) => Promise<any>)
        | ((ctx: any) => Promise<any>)
        | ((ctx: any, param?: any) => Promise<any>)
    ? M[K]
    : never;
};
