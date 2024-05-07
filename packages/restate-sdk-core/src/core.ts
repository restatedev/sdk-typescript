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

// ----------- service -------------------------------------------------------

export type ServiceHandler<F> = F extends (
  ctx: infer _C extends RestateContext
) => Promise<any>
  ? F
  : F extends (ctx: infer _C extends RestateContext, input: any) => Promise<any>
  ? F
  : never;

type WithoutRpcContext<F> = F extends (ctx: any, ...args: infer P) => infer R
  ? (...args: P) => R
  : never;

export type Service<U> = {
  [K in keyof U]: U[K] extends ServiceHandler<infer F>
    ? WithoutRpcContext<F>
    : never;
};

export type ServiceDefinition<P extends string, M> = {
  name: P;
  service?: Service<M>;
};

// ----------- object -------------------------------------------------------

export type ObjectSharedHandler<F> = F extends (
  ctx: RestateObjectSharedContext,
  param: any
) => Promise<any>
  ? F
  : F extends (ctx: infer _C extends RestateObjectSharedContext) => Promise<any>
  ? F
  : never;

export type ObjectHandler<F> = F extends (
  ctx: infer _C extends RestateObjectContext,
  param: any
) => Promise<any>
  ? F
  : F extends (ctx: infer _C extends RestateObjectContext) => Promise<any>
  ? F
  : never;

export type VirtualObject<U> = {
  [K in keyof U]: U[K] extends ObjectHandler<infer F>
    ? WithoutRpcContext<F>
    : never;
};

export type VirtualObjectDefinition<P extends string, M> = {
  name: P;
  object?: VirtualObject<M>;
};
