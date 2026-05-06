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
  connect,
} from "@restatedev/restate-sdk-clients";
import type { HandlerDescriptor, Descriptor } from "./define.js";

// Re-export connect, Ingress, SendOpts so consumers can use clients.connect / clients.Ingress
export { connect, SendOpts, type Ingress, type Send, type Opts, type IngressClient, type IngressWorkflowClient, type IngressSendClient };

/**
 * Minimal ingress interface required by the sdk-gen ingress helpers.
 * Structurally compatible with `Ingress` from `@restatedev/restate-sdk-clients`
 * — any object returned by `connect()` satisfies this.
 */
export interface GenIngress {
  call<I, O>(opts: {
    service: string;
    handler: string;
    parameter: I;
    key?: string;
    opts?: Opts<I, O>;
  }): Promise<O>;
  send<I>(opts: {
    service: string;
    handler: string;
    parameter: I;
    key?: string;
    opts?: SendOpts<I>;
  }): Promise<Send>;
}

// =============================================================================
// Typed ingress client types
// =============================================================================

type InferInput<D> = D extends HandlerDescriptor<infer I, any> ? I : unknown;
type InferOutput<D> = D extends HandlerDescriptor<any, infer O> ? O : unknown;

/** Typed ingress call client — each method returns Promise<O> */
export type IngressHandlerClient<H extends Record<string, HandlerDescriptor>> = {
  readonly [K in keyof H]: (
    input: InferInput<H[K]>,
    opts?: Opts<InferInput<H[K]>, InferOutput<H[K]>>
  ) => Promise<InferOutput<H[K]>>;
};

/** Typed ingress send client — each method returns Promise<Send> */
export type IngressSendHandlerClient<H extends Record<string, HandlerDescriptor>> = {
  readonly [K in keyof H]: [InferInput<H[K]>] extends [void]
    ? (opts?: SendOpts<void>) => Promise<Send>
    : (input: InferInput<H[K]>, opts?: SendOpts<InferInput<H[K]>>) => Promise<Send>;
};

// =============================================================================
// client / sendClient (aliases for ingressClient / ingressSendClient)
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
          opts: mergedOpts,
        });
      };
    },
  });
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
        throw new TypeError("The second argument must be either Opts or SendOpts");
      }
      break;
    default:
      throw new TypeError("unexpected number of arguments");
  }
  return { parameter, opts };
}
