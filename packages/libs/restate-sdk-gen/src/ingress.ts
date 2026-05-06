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
  type Ingress,
  type Send,
} from "@restatedev/restate-sdk-clients";
import type { HandlerDescriptor, Descriptor } from "./define.js";
export {
  type Ingress,
  Opts,
  SendOpts,
  connect,
  type ConnectionOpts,
  type IngressClient,
  type IngressWorkflowClient,
  type IngressSendClient,
} from "@restatedev/restate-sdk-clients";

// =============================================================================
// Typed ingress client types
// =============================================================================

type InferInput<D> = D extends HandlerDescriptor<infer I, any> ? I : unknown;
type InferOutput<D> = D extends HandlerDescriptor<any, infer O> ? O : unknown;

/**
 * Typed ingress call client derived from a handler descriptor map.
 * Uses `ingress.call()` internally — serdes from the interface descriptors
 * are injected into every request.
 */
export type IngressHandlerClient<H extends Record<string, HandlerDescriptor>> =
  {
    readonly [K in keyof H]: (
      input: InferInput<H[K]>,
      opts?: Opts<InferInput<H[K]>, InferOutput<H[K]>>
    ) => Promise<InferOutput<H[K]>>;
  };

/**
 * Typed ingress send client derived from a handler descriptor map.
 * Uses `ingress.send()` internally — each method returns Promise<Send<O>>.
 */
export type IngressSendHandlerClient<
  H extends Record<string, HandlerDescriptor>,
> = {
  readonly [K in keyof H]: [InferInput<H[K]>] extends [void]
    ? (opts?: SendOpts<any>) => Promise<Send<InferOutput<H[K]>>>
    : (
        input: InferInput<H[K]>,
        opts?: SendOpts<InferInput<H[K]>>
      ) => Promise<Send<InferOutput<H[K]>>>;
};

// =============================================================================
// client — uses ingress.call() directly, injects descriptor serdes
// =============================================================================

export function client<H extends Record<string, HandlerDescriptor>>(
  ingress: Ingress,
  def: Descriptor<string, H, "service">
): IngressHandlerClient<H>;
export function client<H extends Record<string, HandlerDescriptor>>(
  ingress: Ingress,
  def: Descriptor<string, H, "object" | "workflow">,
  key: string
): IngressHandlerClient<H>;
export function client(
  ingress: Ingress,
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

// =============================================================================
// sendClient — uses ingress.send() directly
// =============================================================================

export function sendClient<H extends Record<string, HandlerDescriptor>>(
  ingress: Ingress,
  def: Descriptor<string, H, "service">
): IngressSendHandlerClient<H>;
export function sendClient<H extends Record<string, HandlerDescriptor>>(
  ingress: Ingress,
  def: Descriptor<string, H, "object" | "workflow">,
  key: string
): IngressSendHandlerClient<H>;
export function sendClient(
  ingress: Ingress,
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

// Copied over from ingress
function optsFromArgs(args: unknown[]): {
  parameter?: unknown;
  opts?: Opts<unknown, unknown> | SendOpts<unknown>;
} {
  let parameter: unknown;
  let opts: Opts<unknown, unknown> | SendOpts<unknown> | undefined;
  switch (args.length) {
    case 0: {
      break;
    }
    case 1: {
      if (args[0] instanceof Opts) {
        opts = args[0];
      } else if (args[0] instanceof SendOpts) {
        opts = args[0];
      } else {
        parameter = args[0];
      }
      break;
    }
    case 2: {
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
    }
    default: {
      throw new TypeError("unexpected number of arguments");
    }
  }
  return {
    parameter,
    opts,
  };
}
