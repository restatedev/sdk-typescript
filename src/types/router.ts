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

import { CombineablePromise, Context, KeyedContext } from "../context";
import { Event } from "./types";

// ----------- generics -------------------------------------------------------

type WithKeyArgument<F> = F extends () => infer R ? (key: string) => R : F;

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

export type UnKeyedHandler<F> = F extends (ctx: Context) => Promise<any>
  ? F
  : F extends (ctx: Context, input: any) => Promise<any>
  ? F
  : never;

export type UnKeyedRouterOpts<U> = {
  [K in keyof U]: U[K] extends UnKeyedHandler<any> ? U[K] : never;
};

export type UnKeyedRouter<U> = {
  [K in keyof U]: U[K] extends UnKeyedHandler<infer F>
    ? WithoutRpcContext<F>
    : never;
};

export const router = <M>(opts: UnKeyedRouterOpts<M>): UnKeyedRouter<M> => {
  if (opts === undefined || opts === null) {
    throw new Error("router must be defined");
  }
  return opts as UnKeyedRouter<M>;
};

// ----------- keyed handlers ----------------------------------------------

export type KeyedHandler<F> = F extends (ctx: KeyedContext) => Promise<any>
  ? F
  : F extends (ctx: KeyedContext, key: string, value: any) => Promise<any>
  ? F
  : never;

export type KeyedRouterOpts<U> = {
  [K in keyof U]: U[K] extends KeyedHandler<U[K]> | KeyedEventHandler<U[K]>
    ? U[K]
    : never;
};

export type KeyedRouter<U> = {
  [K in keyof U]: U[K] extends KeyedEventHandler<U[K]>
    ? never
    : U[K] extends KeyedHandler<infer F>
    ? WithKeyArgument<WithoutRpcContext<F>>
    : never;
};

export const keyedRouter = <M>(opts: KeyedRouterOpts<M>): KeyedRouter<M> => {
  if (opts === undefined || opts === null) {
    throw new Error("router must be defined");
  }
  return opts as KeyedRouter<M>;
};

// ----------- event handlers ----------------------------------------------

export type KeyedEventHandler<U> = U extends () => Promise<void>
  ? never
  : U extends (ctx: KeyedContext) => Promise<void>
  ? never
  : U extends (ctx: KeyedContext, event: Event) => Promise<void>
  ? U
  : never;

export const keyedEventHandler = <H>(handler: KeyedEventHandler<H>): H => {
  return { eventHandler: true, handler: handler } as H;
};

export const isEventHandler = (
  handler: any
): handler is {
  handler: (ctx: KeyedContext, event: Event) => Promise<void>;
} => {
  return typeof handler === "object" && handler["eventHandler"];
};
