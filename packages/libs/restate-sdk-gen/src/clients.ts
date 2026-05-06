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

import * as restate from "@restatedev/restate-sdk";
import type { Future } from "./future.js";
import type { InvocationReference } from "./invocation-reference.js";
import type { HandlerDescriptor, Descriptor } from "./define.js";
import {
  ClientCallOptions,
  ClientSendOptions,
  Opts,
  SendOpts,
} from "@restatedev/restate-sdk";

/**
 * A Future<O> that also carries an `invocation` field — a Future<InvocationReference<O>>
 * for accessing the invocationId, attach, cancel, and signal of the underlying call.
 */
export type ClientFuture<O> = Future<O> & {
  invocation: Future<InvocationReference<O>>;
};

/** Client type returned by client() — each method returns ClientFuture<O> */
export type GenClient<H extends Record<string, HandlerDescriptor>> = {
  readonly [K in keyof H]: H[K] extends HandlerDescriptor<infer I, infer O>
    ? [I] extends [void]
      ? (opts?: Opts<I, O>) => ClientFuture<O>
      : (input: I, opts?: Opts<I, O>) => ClientFuture<O>
    : never;
};

/** Client type returned by sendClient() — each method returns Future<InvocationReference<O>> */
export type GenSendClient<H extends Record<string, HandlerDescriptor>> = {
  readonly [K in keyof H]: H[K] extends HandlerDescriptor<infer I, infer O>
    ? [I] extends [void]
      ? (opts?: SendOpts<I>) => Future<InvocationReference<O>>
      : (input: I, opts?: SendOpts<I>) => Future<InvocationReference<O>>
    : never;
};

// =============================================================================
// makeClient / makeSendClient — proxy factories used by RestateOperations
// =============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

type GenericCallFn = (opts: {
  service: string;
  key?: string;
  method: string;
  parameter: unknown;
  inputSerde: restate.Serde<unknown>;
  outputSerde: restate.Serde<unknown>;
  idempotencyKey?: string;
  headers?: Record<string, string>;
  name?: string;
}) => restate.RestatePromise<unknown>;

type GenericSendFn = (opts: {
  service: string;
  key?: string;
  method: string;
  parameter: unknown;
  inputSerde: restate.Serde<unknown>;
  delay?: restate.Duration | number;
  idempotencyKey?: string;
  headers?: Record<string, string>;
  name?: string;
}) => restate.InvocationHandle;

type ToFutureFn<T> = (p: restate.RestatePromise<T>) => Future<T>;
type ToRefFn = (
  handle: restate.InvocationHandle,
  outputSerde?: restate.Serde<unknown>
) => Future<InvocationReference<unknown>>;

export function makeClient<H extends Record<string, HandlerDescriptor>>(
  def: Descriptor<string, H, any>,
  key: string | undefined,
  genericCall: GenericCallFn,
  toFuture: ToFutureFn<unknown>,
  toRef: ToRefFn
): GenClient<H> {
  return new Proxy({} as any, {
    get(_target, methodName: string) {
      return (...args: unknown[]) => {
        const { parameter, opts } = optsFromArgs(args);
        const callOpts = opts as ClientCallOptions<unknown, unknown>;
        const desc = def._handlers[methodName];
        const outputSerde = callOpts?.output ?? desc?._outputSerde;
        const restatePromise = genericCall({
          service: def.name,
          key,
          method: String(methodName),
          parameter,
          inputSerde: (callOpts?.input ??
            desc?._inputSerde ??
            restate.serde.json) as restate.Serde<unknown>,
          outputSerde: (outputSerde ??
            restate.serde.json) as restate.Serde<unknown>,
          idempotencyKey: callOpts?.idempotencyKey,
          headers: callOpts?.headers,
          name: callOpts?.name,
        });
        const resultFuture = toFuture(restatePromise);
        const invHandle =
          restatePromise as unknown as restate.InvocationPromise<unknown>;
        const invocation = toRef(invHandle, outputSerde);

        return Object.assign(resultFuture, {
          invocation,
        }) as ClientFuture<unknown>;
      };
    },
  }) as GenClient<H>;
}

export function makeSendClient<H extends Record<string, HandlerDescriptor>>(
  def: Descriptor<string, H, any>,
  key: string | undefined,
  genericSend: GenericSendFn,
  toRef: ToRefFn
): GenSendClient<H> {
  return new Proxy({} as any, {
    get(_target, methodName: string) {
      return (...args: unknown[]) => {
        const { parameter, opts } = optsFromArgs(args);
        const sendOpts = opts as ClientSendOptions<unknown>;
        const desc = def._handlers[methodName];
        const handle = genericSend({
          service: def.name,
          key,
          method: String(methodName),
          parameter,
          inputSerde: (sendOpts?.input ??
            desc?._inputSerde ??
            restate.serde.json) as restate.Serde<unknown>,
          delay: sendOpts?.delay,
          idempotencyKey: sendOpts?.idempotencyKey,
          headers: sendOpts?.headers,
          name: sendOpts?.name,
        });
        return toRef(handle, desc?._outputSerde);
      };
    },
  }) as GenSendClient<H>;
}

function optsFromArgs(args: unknown[]): {
  parameter?: unknown;
  opts?:
    | ClientCallOptions<unknown, unknown>
    | ClientSendOptions<unknown>
    | undefined;
} {
  let parameter: unknown;
  let opts:
    | ClientCallOptions<unknown, unknown>
    | ClientSendOptions<unknown>
    | undefined;
  switch (args.length) {
    case 0: {
      break;
    }
    case 1: {
      if (args[0] instanceof Opts) {
        opts = args[0].getOpts();
      } else if (args[0] instanceof SendOpts) {
        opts = args[0].getOpts();
      } else {
        parameter = args[0];
      }
      break;
    }
    case 2: {
      parameter = args[0];
      if (args[1] instanceof Opts) {
        opts = args[1].getOpts();
      } else if (args[1] instanceof SendOpts) {
        opts = args[1].getOpts();
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
