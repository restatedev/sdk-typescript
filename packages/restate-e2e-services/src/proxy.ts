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
import { TerminalError } from "@restatedev/restate-sdk";

type ProxyRequest = {
  serviceName: string;
  virtualObjectKey?: string;
  handlerName: string;
  message: Array<number>;
  delayMillis?: number;
  idempotencyKey?: string;
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
  return ctx.call({
    service: request.serviceName,
    method: request.handlerName,
    key: request.virtualObjectKey,
    inputSerde: restate.serde.binary,
    outputSerde: restate.serde.binary,
    parameter: new Uint8Array(request.message),
    idempotencyKey: request.idempotencyKey,
  });
}

function rawSend(ctx: restate.Context, request: ProxyRequest): Promise<string> {
  const handle = ctx.send({
    service: request.serviceName,
    method: request.handlerName,
    key: request.virtualObjectKey,
    inputSerde: restate.serde.binary,
    parameter: new Uint8Array(request.message),
    delay: { milliseconds: request.delayMillis },
    idempotencyKey: request.idempotencyKey,
  });
  return handle.invocationId;
}

const o = restate.service({
  name: "Proxy",
  handlers: {
    async call(ctx: restate.Context, request: ProxyRequest) {
      return Array.from(await rawCall(ctx, request));
    },

    async oneWayCall(ctx: restate.Context, request: ProxyRequest) {
      return rawSend(ctx, request);
    },

    async manyCalls(ctx: restate.Context, request: ManyCallRequest[]) {
      const toAwait = [];

      for (const r of request) {
        if (r.oneWayCall) {
          await rawSend(ctx, r.proxyRequest);
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
