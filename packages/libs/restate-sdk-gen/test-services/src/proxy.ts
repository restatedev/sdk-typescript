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
import {
  service,
  call,
  send,
  all,
  type Future,
} from "@restatedev/restate-sdk-gen";

type ProxyRequest = {
  serviceName: string;
  handlerName: string;
  message: number[];
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

export const proxy = service({
  name: "Proxy",
  handlers: {
    *call(req: ProxyRequest) {
      const result = yield* call<Uint8Array, Uint8Array>({
        service: req.serviceName,
        method: req.handlerName,
        parameter: toBytes(req.message),
        key: req.virtualObjectKey,
        idempotencyKey: req.idempotencyKey,
        inputSerde: restate.serde.binary,
        outputSerde: restate.serde.binary,
      });
      return Array.from(result);
    },

    *oneWayCall(req: ProxyRequest) {
      const ref = yield* send<Uint8Array>({
        service: req.serviceName,
        method: req.handlerName,
        parameter: toBytes(req.message),
        key: req.virtualObjectKey,
        idempotencyKey: req.idempotencyKey,
        inputSerde: restate.serde.binary,
        delay: req.delayMillis,
      });
      return ref.invocationId;
    },

    *manyCalls(requests: ManyCallsRequest[]) {
      const toAwait: Future<Uint8Array>[] = [];
      for (const req of requests) {
        const pr = req.proxyRequest;
        if (req.oneWay) {
          send<Uint8Array>({
            service: pr.serviceName,
            method: pr.handlerName,
            parameter: toBytes(pr.message),
            key: pr.virtualObjectKey,
            idempotencyKey: pr.idempotencyKey,
            inputSerde: restate.serde.binary,
          });
        } else {
          const future = call<Uint8Array, Uint8Array>({
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
      if (toAwait.length > 0) yield* all(toAwait);
    },
  },
});
