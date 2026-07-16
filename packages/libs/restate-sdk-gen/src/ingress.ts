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
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access */

import {
  Opts,
  SendOpts,
  type Send,
  type Ingress,
  type IngressClient,
  type IngressWorkflowClient,
  type IngressSendClient,
  type ConnectionOpts,
  type RetryPolicy,
  type RetryFailure,
  connect as clientsConnect,
  defaultShouldRetry,
  HttpCallError,
} from "@restatedev/restate-sdk-clients";
import type { HandlerDescriptor, Descriptor } from "./define.js";

// Re-export connect, Ingress, SendOpts so consumers can use clients.connect / clients.Ingress
export {
  Opts,
  SendOpts,
  defaultShouldRetry,
  HttpCallError,
  type ConnectionOpts,
  type RetryPolicy,
  type RetryFailure,
  type Ingress,
  type Send,
  type IngressClient,
  type IngressWorkflowClient,
  type IngressSendClient,
};

/**
 * Connect to the Restate Ingress.
 *
 * @param opts connection options
 * @returns a connection the the restate ingress
 */
export function connect(opts: ConnectionOpts): GenIngress {
  return clientsConnect(opts);
}

/**
 * Minimal ingress interface required by the sdk-gen ingress helpers.
 * Structurally compatible with `Ingress` from `@restatedev/restate-sdk-clients`
 * — any object returned by `connect()` satisfies this.
 */
export type GenIngress = Omit<
  Ingress,
  | "serviceClient"
  | "serviceSendClient"
  | "objectClient"
  | "objectSendClient"
  | "workflowClient"
>;

// =============================================================================
// Typed ingress client types
// =============================================================================

type InferInput<D> = D extends HandlerDescriptor<infer I, any> ? I : unknown;
type InferOutput<D> = D extends HandlerDescriptor<any, infer O> ? O : unknown;

/** Typed ingress call client — each method returns Promise<O> */
export type IngressHandlerClient<H extends Record<string, HandlerDescriptor>> =
  {
    readonly [K in keyof H]: (
      input: InferInput<H[K]>,
      opts?: Opts<InferInput<H[K]>, InferOutput<H[K]>>
    ) => Promise<InferOutput<H[K]>>;
  };

/** Typed ingress send client — each method returns Promise<Send> */
export type IngressSendHandlerClient<
  H extends Record<string, HandlerDescriptor>,
> = {
  readonly [K in keyof H]: [InferInput<H[K]>] extends [void]
    ? (opts?: SendOpts<void>) => Promise<Send>
    : (
        input: InferInput<H[K]>,
        opts?: SendOpts<InferInput<H[K]>>
      ) => Promise<Send>;
};

// =============================================================================
// client / sendClient
// =============================================================================

export function client<H extends Record<string, HandlerDescriptor>>(
  ingress: GenIngress,
  def: Descriptor<string, H, "service">
): IngressHandlerClient<H>;
export function client<H extends Record<string, HandlerDescriptor>>(
  ingress: GenIngress,
  def: Descriptor<string, H, "object" | "workflow">,
  key: string
): IngressHandlerClient<H>;
export function client(
  ingress: GenIngress,
  def: Descriptor<string, any, any>,
  key?: string
): IngressHandlerClient<any> {
  return makeIngressClient(ingress, def, key);
}

export function sendClient<H extends Record<string, HandlerDescriptor>>(
  ingress: GenIngress,
  def: Descriptor<string, H, "service">
): IngressSendHandlerClient<H>;
export function sendClient<H extends Record<string, HandlerDescriptor>>(
  ingress: GenIngress,
  def: Descriptor<string, H, "object" | "workflow">,
  key: string
): IngressSendHandlerClient<H>;
export function sendClient(
  ingress: GenIngress,
  def: Descriptor<string, any, any>,
  key?: string
): IngressSendHandlerClient<any> {
  return makeIngressSendClient(ingress, def, key);
}

/**
 * Ingress client bundle bound to a specific scope, returned by {@link scope}.
 * Mirrors the in-handler `scope(...)` surface: same `client`/`sendClient`
 * overloads, but every call/send routes within the bound scope.
 */
export interface ScopedGenIngress {
  client<H extends Record<string, HandlerDescriptor>>(
    def: Descriptor<string, H, "service">
  ): IngressHandlerClient<H>;
  client<H extends Record<string, HandlerDescriptor>>(
    def: Descriptor<string, H, "object" | "workflow">,
    key: string
  ): IngressHandlerClient<H>;
  sendClient<H extends Record<string, HandlerDescriptor>>(
    def: Descriptor<string, H, "service">
  ): IngressSendHandlerClient<H>;
  sendClient<H extends Record<string, HandlerDescriptor>>(
    def: Descriptor<string, H, "object" | "workflow">,
    key: string
  ): IngressSendHandlerClient<H>;
}

/**
 * Route all ingress calls/sends through a named scope. The in-handler
 * `scope(scopeKey)` and this `scope(ingress, scopeKey)` produce the same
 * `.client(def)` / `.sendClient(def)` shape, so handler and ingress code
 * read identically (modulo the explicit `ingress`).
 *
 * @example
 *   await clients.scope(ingress, "tenant-123").client(Greeter).greet(name);
 *   await clients.scope(ingress, "tenant-123").client(Cart, "cart-42").add(item);
 */
export function scope(ingress: GenIngress, scopeKey: string): ScopedGenIngress {
  return {
    client: (def: Descriptor<string, any, any>, key?: string) =>
      makeIngressClient(ingress, def, key, scopeKey),
    sendClient: (def: Descriptor<string, any, any>, key?: string) =>
      makeIngressSendClient(ingress, def, key, scopeKey),
  } as ScopedGenIngress;
}

function makeIngressClient(
  ingress: GenIngress,
  def: Descriptor<string, any, any>,
  key?: string,
  scope?: string
): IngressHandlerClient<any> {
  return new Proxy({} as any, {
    get(_target, methodName: string) {
      return (...args: unknown[]) => {
        const { parameter, opts } = optsFromArgs(args);
        const desc = def._handlers[methodName] as HandlerDescriptor | undefined;
        const mergedOpts = Opts.from({
          ...opts?.opts,
          input: opts?.opts?.input ?? desc?._inputSerde,
          output: opts?.opts?.output ?? desc?._outputSerde,
        });
        return ingress.call<unknown, unknown>({
          service: def.name,
          handler: methodName,
          parameter,
          key,
          scope,
          opts: mergedOpts,
        });
      };
    },
  });
}

function makeIngressSendClient(
  ingress: GenIngress,
  def: Descriptor<string, any, any>,
  key?: string,
  scope?: string
): IngressSendHandlerClient<any> {
  return new Proxy({} as any, {
    get(_target, methodName: string) {
      return (...args: unknown[]) => {
        const { parameter, opts } = optsFromArgs(args);
        const desc = def._handlers[methodName] as HandlerDescriptor | undefined;
        const mergedOpts = SendOpts.from<unknown>({
          ...opts?.opts,
          input: opts?.opts?.input ?? desc?._inputSerde,
        } as any);
        return ingress.send({
          service: def.name,
          handler: methodName,
          parameter,
          key,
          scope,
          opts: mergedOpts,
        });
      };
    },
  });
}

// =============================================================================
// optsFromArgs — parses (input, opts?) or (opts?) call signatures
// =============================================================================

function optsFromArgs(args: unknown[]): {
  parameter?: unknown;
  opts?: Opts<unknown, unknown> | SendOpts<unknown>;
} {
  let parameter: unknown;
  let opts: Opts<unknown, unknown> | SendOpts<unknown> | undefined;
  switch (args.length) {
    case 0:
      break;
    case 1:
      if (args[0] instanceof Opts) {
        opts = args[0];
      } else if (args[0] instanceof SendOpts) {
        opts = args[0];
      } else {
        parameter = args[0];
      }
      break;
    case 2:
      parameter = args[0];
      if (args[1] instanceof Opts) {
        opts = args[1];
      } else if (args[1] instanceof SendOpts) {
        opts = args[1];
      } else {
        throw new TypeError(
          "The second argument must be either Opts or SendOpts"
        );
      }
      break;
    default:
      throw new TypeError("unexpected number of arguments");
  }
  return { parameter, opts };
}
