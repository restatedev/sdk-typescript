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

// Proxy — service that forwards typed requests via the generic call/send
// API to other services. The test suite uses it as an indirection point
// to exercise call topology with arbitrary service+handler+key triples.
// Mirrors sdk-ruby/test-services/services/proxy.rb.

import * as restate from "@restatedev/restate-sdk";
import {
  gen,
  execute,
  genericCall,
  genericSend,
  all,
  type Future,
} from "@restatedev/restate-sdk-gen";

type ProxyRequest = {
  serviceName: string;
  handlerName: string;
  message: number[]; // raw bytes encoded as a number array (per Ruby)
  virtualObjectKey?: string;
  idempotencyKey?: string;
  delayMillis?: number;
};

type ManyCallsRequest = {
  proxyRequest: ProxyRequest;
  oneWay: boolean;
  awaitAtTheEnd: boolean;
};

function toBytes(message: number[]): Uint8Array {
  return Uint8Array.from(message);
}

export const proxy = restate.service({
  name: "Proxy",
  handlers: {
    call: async (ctx: restate.Context, req: ProxyRequest): Promise<number[]> =>
      execute(
        ctx,
        gen(function* () {
          const result = yield* genericCall<Uint8Array, Uint8Array>({
            service: req.serviceName,
            method: req.handlerName,
            parameter: toBytes(req.message),
            key: req.virtualObjectKey,
            idempotencyKey: req.idempotencyKey,
            inputSerde: restate.serde.binary,
            outputSerde: restate.serde.binary,
          });
          return Array.from(result);
        })
      ),

    oneWayCall: async (
      ctx: restate.Context,
      req: ProxyRequest
    ): Promise<string> => {
      // genericSend is synchronous on Context — record the handle and
      // surface its invocation id, no scheduler needed for a single send.
      const handle = ctx.genericSend<Uint8Array>({
        service: req.serviceName,
        method: req.handlerName,
        parameter: toBytes(req.message),
        key: req.virtualObjectKey,
        idempotencyKey: req.idempotencyKey,
        inputSerde: restate.serde.binary,
        delay: req.delayMillis,
      });
      return await handle.invocationId;
    },

    manyCalls: async (
      ctx: restate.Context,
      requests: ManyCallsRequest[]
    ): Promise<void> =>
      execute(
        ctx,
        gen(function* () {
          const toAwait: Future<Uint8Array>[] = [];
          for (const req of requests) {
            const pr = req.proxyRequest;
            if (req.oneWay) {
              genericSend<Uint8Array>({
                service: pr.serviceName,
                method: pr.handlerName,
                parameter: toBytes(pr.message),
                key: pr.virtualObjectKey,
                idempotencyKey: pr.idempotencyKey,
                inputSerde: restate.serde.binary,
              });
            } else {
              const future = genericCall<Uint8Array, Uint8Array>({
                service: pr.serviceName,
                method: pr.handlerName,
                parameter: toBytes(pr.message),
                key: pr.virtualObjectKey,
                idempotencyKey: pr.idempotencyKey,
                inputSerde: restate.serde.binary,
                outputSerde: restate.serde.binary,
              });
              if (req.awaitAtTheEnd) toAwait.push(future);
            }
          }
          if (toAwait.length > 0) {
            yield* all(toAwait);
          }
        })
      ),
  },
});
