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
};

type ManyCallRequest = {
  proxyRequest: ProxyRequest;
  oneWayCall: boolean;
  awaitAtTheEnd: boolean;
};

async function rawCall(
  ctx: restate.Context,
  serviceName: string,
  handlerName: string,
  message: Array<number>,
  key?: string
) {
  const input = new Uint8Array(message);
  const response: Uint8Array = await ctx.genericCall({
    service: serviceName,
    method: handlerName,
    key: key,
    inputSerde: restate.serde.binary,
    outputSerde: restate.serde.binary,
    parameter: input,
  });

  return Array.from(response);
}

async function rawSend(
  ctx: restate.Context,
  serviceName: string,
  handlerName: string,
  message: Array<number>,
  key?: string
) {
  const input = new Uint8Array(message);
  ctx.genericSend({
    service: serviceName,
    method: handlerName,
    key: key,
    inputSerde: restate.serde.binary,
    parameter: input,
  });
}

const o = restate.service({
  name: "Proxy",
  handlers: {
    async call(ctx: restate.Context, request: ProxyRequest) {
      return await rawCall(
        ctx,
        request.serviceName,
        request.handlerName,
        request.message,
        request.virtualObjectKey
      );
    },

    async oneWayCall(ctx: restate.Context, request: ProxyRequest) {
      return await rawSend(
        ctx,
        request.serviceName,
        request.handlerName,
        request.message,
        request.virtualObjectKey
      );
    },

    async manyCalls(ctx: restate.Context, request: ManyCallRequest[]) {
      const toAwait = [];

      for (const r of request) {
        if (r.oneWayCall) {
          await this.oneWayCall(ctx, r.proxyRequest);
          continue;
        }
        const promise = this.call(ctx, r.proxyRequest);
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
