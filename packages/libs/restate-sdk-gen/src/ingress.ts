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
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument */

/**
 * @deprecated The `clients` ingress adapter is superseded by
 * `@restatedev/restate-sdk-clients`. The service interface / `Descriptor`
 * values produced by this package (`service`/`object`/`workflow`/`iface` /
 * `implement`) are now first-class inputs to that package's ingress client,
 * which reuses their declared serdes automatically:
 *
 * ```ts
 * import { connect } from "@restatedev/restate-sdk-clients";
 * const ingress = connect({ url });
 * await ingress.client(greeter).greet(req);       // service
 * await ingress.client(counter, "k").add(1);      // virtual object / workflow (with key)
 * ```
 *
 * Every export here now delegates to that client and will be removed in a
 * future release.
 */

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
 * @deprecated Use `connect` from `@restatedev/restate-sdk-clients` and its typed
 * client methods, e.g. `connect({ url }).serviceClient(def)`
 */
export function connect(opts: ConnectionOpts): GenIngress {
  return clientsConnect(opts);
}

/**
 * @deprecated Use `connect` from `@restatedev/restate-sdk-clients` and its typed
 * client methods, e.g. `connect({ url }).serviceClient(def)`
 */
export type GenIngress = Ingress;

// =============================================================================
// Typed ingress client types
// =============================================================================

type InferInput<D> = D extends HandlerDescriptor<infer I, any> ? I : unknown;
type InferOutput<D> = D extends HandlerDescriptor<any, infer O> ? O : unknown;

/**
 * Typed ingress call client — each method returns Promise<O>.
 *
 * @deprecated Use the client returned by `ingress.serviceClient(def)` /
 * `ingress.objectClient(def, key)` from `@restatedev/restate-sdk-clients`.
 */
export type IngressHandlerClient<H extends Record<string, HandlerDescriptor>> =
  {
    readonly [K in keyof H]: (
      input: InferInput<H[K]>,
      opts?: Opts<InferInput<H[K]>, InferOutput<H[K]>>
    ) => Promise<InferOutput<H[K]>>;
  };

/**
 * Typed ingress send client — each method returns Promise<Send>.
 *
 * @deprecated Use the client returned by `ingress.serviceSendClient(def)` /
 * `ingress.objectSendClient(def, key)` from `@restatedev/restate-sdk-clients`.
 */
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
// client / sendClient — thin wrappers over the regular ingress client.
// =============================================================================

/**
 * @deprecated Call the regular ingress client directly: `ingress.client(def)`
 * for a service, or `ingress.client(def, key)` for a virtual object / workflow.
 */
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
  return (key === undefined
    ? ingress.client(def as any)
    : ingress.client(def as any, key)) as unknown as IngressHandlerClient<any>;
}

/**
 * @deprecated Call the regular ingress client directly: `ingress.sendClient(def)`
 * for a service, or `ingress.sendClient(def, key)` for a virtual object / workflow.
 */
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
  return (key === undefined
    ? ingress.sendClient(def as any)
    : ingress.sendClient(
        def as any,
        key
      )) as unknown as IngressSendHandlerClient<any>;
}

/**
 * @deprecated Use `ingress.scope(scopeKey)` from
 * `@restatedev/restate-sdk-clients` and its `client`/`sendClient` methods.
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
 * @deprecated Use `ingress.scope(scopeKey)` from
 * `@restatedev/restate-sdk-clients`, then `.client(def)` / `.sendClient(def)`
 * on the returned scoped ingress.
 */
export function scope(ingress: GenIngress, scopeKey: string): ScopedGenIngress {
  const scoped = ingress.scope(scopeKey);
  return {
    client: (def: Descriptor<string, any, any>, key?: string) =>
      (key === undefined
        ? scoped.client(def as any)
        : scoped.client(def as any, key)) as unknown,
    sendClient: (def: Descriptor<string, any, any>, key?: string) =>
      (key === undefined
        ? scoped.sendClient(def as any)
        : scoped.sendClient(def as any, key)) as unknown,
  } as ScopedGenIngress;
}
