// Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
//
// This file is part of the Restate e2e tests,
// which are released under the MIT license.
//
// You can find a copy of the license in file LICENSE in the root
// directory of this repository or package, or at
// https://github.com/restatedev/e2e/blob/main/LICENSE

/* eslint-disable */

import * as restate from "@restatedev/restate-sdk";
import { REGISTRY } from "./services.js";

type ProxyRequest = {
  serviceName: string;
  virtualObjectKey?: string;
  handlerName: string;
  message: Array<number>;
  delayMillis?: number;
};

type ManyCallRequest = {
  proxyRequest: ProxyRequest;
  oneWayCall: boolean;
  awaitAtTheEnd: boolean;
};

function rawCall(
  ctx: restate.Context,
  request: ProxyRequest
): Promise<Uint8Array> {
  return ctx.genericCall({
    service: request.serviceName,
    method: request.handlerName,
    key: request.virtualObjectKey,
    inputSerde: restate.serde.binary,
    outputSerde: restate.serde.binary,
    parameter: new Uint8Array(request.message),
  });
}

function rawSend(ctx: restate.Context, request: ProxyRequest) {
  ctx.genericSend({
    service: request.serviceName,
    method: request.handlerName,
    key: request.virtualObjectKey,
    inputSerde: restate.serde.binary,
    parameter: new Uint8Array(request.message),
    delay: request.delayMillis,
  });
}

const o = restate.service({
  name: "Proxy",
  handlers: {
    async call(ctx: restate.Context, request: ProxyRequest) {
      return Array.from(await rawCall(ctx, request));
    },

    async oneWayCall(ctx: restate.Context, request: ProxyRequest) {
      rawSend(ctx, request);
    },

    async manyCalls(ctx: restate.Context, request: ManyCallRequest[]) {
      const toAwait = [];

      for (const r of request) {
        if (r.oneWayCall) {
          rawSend(ctx, r.proxyRequest);
          continue;
        }
        const promise = rawCall(ctx, r.proxyRequest);
        if (r.awaitAtTheEnd) {
          toAwait.push(promise);
        }
      }
      for (const p of toAwait) {
        await p;
      }
    },
  },
});

REGISTRY.addObject(o);
