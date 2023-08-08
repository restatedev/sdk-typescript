/* eslint-disable @typescript-eslint/no-explicit-any */

import { RpcContext } from "../restate_context";

// ----------- generics -------------------------------------------------------

type WithKeyArgument<F> = F extends () => infer R ? (key: string) => R : F;

type WithoutRpcContext<F> = F extends (
  ctx: RpcContext,
  ...args: infer P
) => infer R
  ? (...args: P) => R
  : never;

export type Client<M> = {
  [K in keyof M]: M[K];
};

export type SendClient<M> = {
  [K in keyof M]: M[K] extends (...args: infer P) => any
    ? (...args: P) => void
    : never;
};

// ----------- unkeyed handlers ----------------------------------------------

export type UnKeyedHandler<F> = F extends (ctx: RpcContext) => Promise<any>
  ? F
  : F extends (ctx: RpcContext, input: any) => Promise<any>
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

export type KeyedHandler<F> = F extends (ctx: RpcContext) => Promise<any>
  ? F
  : F extends (ctx: RpcContext, key: string, value: any) => Promise<any>
  ? F
  : never;

export type KeyedRouterOpts<U> = {
  [K in keyof U]: U[K] extends KeyedHandler<any> ? U[K] : never;
};

export type KeyedRouter<U> = {
  [K in keyof U]: U[K] extends KeyedHandler<infer F>
    ? WithKeyArgument<WithoutRpcContext<F>>
    : never;
};

export const keyedRouter = <M>(opts: KeyedRouterOpts<M>): KeyedRouter<M> => {
  if (opts === undefined || opts === null) {
    throw new Error("router must be defined");
  }
  return opts as KeyedRouter<M>;
};
