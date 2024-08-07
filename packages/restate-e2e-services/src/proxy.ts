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

const o = restate.service({
  name: "Proxy",
  handlers: {
    async call(ctx: restate.Context, request: ProxyRequest) {
      if (request.virtualObjectKey) {
        const cli = ctx.objectClient(
          { name: request.serviceName },
          request.virtualObjectKey
        );
        return await (cli as any)[request.handlerName](request.message);
      }
      const cli = ctx.serviceClient({ name: request.serviceName });
      return await (cli as any)[request.handlerName](request.message);
    },

    async oneWayCall(ctx: restate.Context, request: ProxyRequest) {
      if (request.virtualObjectKey) {
        const cli = ctx.objectSendClient(
          { name: request.serviceName },
          request.virtualObjectKey
        );
        (cli as any)[request.handlerName](request.message);
        return;
      }
      const cli = ctx.serviceSendClient({ name: request.serviceName });
      (cli as any)[request.handlerName](request.message);
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
