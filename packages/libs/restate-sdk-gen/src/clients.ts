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

/**
 * A Future<O> that also carries `.reference()` for accessing the
 * InvocationReference of the underlying call (invocationId, attach, signal, cancel).
 */
export type ClientFuture<O> = Future<O> & {
  reference(): Future<InvocationReference<O>>;
};

/** Client type returned by client() — each method returns ClientFuture<O> */
export type GenClient<H extends Record<string, HandlerDescriptor>> = {
  readonly [K in keyof H]: H[K] extends HandlerDescriptor<infer I, infer O>
    ? [I] extends [void]
      ? () => ClientFuture<O>
      : (input: I) => ClientFuture<O>
    : never;
};

/** Client type returned by sendClient() — each method returns Future<InvocationReference<O>> */
export type GenSendClient<H extends Record<string, HandlerDescriptor>> = {
  readonly [K in keyof H]: H[K] extends HandlerDescriptor<infer I, infer O>
    ? [I] extends [void]
      ? () => Future<InvocationReference<O>>
      : (input: I) => Future<InvocationReference<O>>
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
}) => restate.RestatePromise<unknown>;

type GenericSendFn = (opts: {
  service: string;
  key?: string;
  method: string;
  parameter: unknown;
  inputSerde: restate.Serde<unknown>;
  delay?: restate.Duration | number;
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
      return (
        input: unknown,
        callOpts?: restate.ClientCallOptions<unknown, unknown>
      ) => {
        const desc = def._handlers[methodName];
        const outputSerde = callOpts?.output ?? desc?._outputSerde;
        const restatePromise = genericCall({
          service: def.name,
          key,
          method: String(methodName),
          parameter: input,
          inputSerde: (callOpts?.input ??
            desc?._inputSerde ??
            restate.serde.json) as restate.Serde<unknown>,
          outputSerde: (outputSerde ??
            restate.serde.json) as restate.Serde<unknown>,
        });
        const resultFuture = toFuture(restatePromise);

        let _referenceFuture: Future<InvocationReference<unknown>> | undefined;
        const reference = () => {
          if (!_referenceFuture) {
            const invHandle =
              restatePromise as unknown as restate.InvocationPromise<unknown>;
            _referenceFuture = toRef(invHandle, outputSerde);
          }
          return _referenceFuture;
        };

        return Object.assign(resultFuture, {
          reference,
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
      return (
        input: unknown,
        sendOpts?: restate.ClientSendOptions<unknown>
      ) => {
        const desc = def._handlers[methodName];
        const handle = genericSend({
          service: def.name,
          key,
          method: String(methodName),
          parameter: input,
          inputSerde: (sendOpts?.input ??
            desc?._inputSerde ??
            restate.serde.json) as restate.Serde<unknown>,
          delay: sendOpts?.delay,
        });
        return toRef(handle, desc?._outputSerde);
      };
    },
  }) as GenSendClient<H>;
}
