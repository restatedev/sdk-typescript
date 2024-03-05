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

import { CombineablePromise, Context, ObjectContext } from "../context";

// ----------- generics -------------------------------------------------------

type WithoutRpcContext<F> = F extends (
  ctx: infer C extends Context,
  ...args: infer P
) => infer R
  ? (...args: P) => R
  : never;

export type Client<M> = {
  [K in keyof M as M[K] extends never ? never : K]: M[K] extends (
    ...args: infer P
  ) => PromiseLike<infer O>
    ? (...args: P) => CombineablePromise<O>
    : never;
};

export type SendClient<M> = {
  [K in keyof M as M[K] extends never ? never : K]: M[K] extends (
    ...args: infer P
  ) => any
    ? (...args: P) => void
    : never;
};

// ----------- unkeyed handlers ----------------------------------------------

export type ServiceHandler<F> = F extends (ctx: Context) => Promise<any>
  ? F
  : F extends (ctx: Context, input: any) => Promise<any>
  ? F
  : never;

export type ServiceOpts<U> = {
  [K in keyof U]: U[K] extends ServiceHandler<any> ? U[K] : never;
};

export type Service<U> = {
  [K in keyof U]: U[K] extends ServiceHandler<infer F>
    ? WithoutRpcContext<F>
    : never;
};

export const service = <M>(opts: ServiceOpts<M>): Service<M> => {
  if (opts === undefined || opts === null) {
    throw new Error("service must be defined");
  }
  return opts as Service<M>;
};

// ----------- keyed handlers ----------------------------------------------

export type ObjectHandler<F> = F extends (
  ctx: ObjectContext,
  param: any
) => Promise<any>
  ? F
  : F extends (ctx: ObjectContext) => Promise<any>
  ? F
  : never;

export type ObjectOpts<U> = {
  [K in keyof U]: U[K] extends ObjectHandler<U[K]> ? U[K] : never;
};

export type VirtualObject<U> = {
  [K in keyof U]: U[K] extends ObjectHandler<infer F>
    ? WithoutRpcContext<F>
    : never;
};

export const object = <M>(opts: ObjectOpts<M>): VirtualObject<M> => {
  if (opts === undefined || opts === null) {
    throw new Error("object options must be defined");
  }
  return opts as VirtualObject<M>;
};
