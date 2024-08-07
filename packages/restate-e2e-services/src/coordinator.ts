// Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
//
// This file is part of the Restate e2e tests,
// which are released under the MIT license.
//
// You can find a copy of the license in file LICENSE in the root
// directory of this repository or package, or at
// https://github.com/restatedev/e2e/blob/main/LICENSE

import * as restate from "@restatedev/restate-sdk";

import { TimeoutError } from "@restatedev/restate-sdk";
import { REGISTRY } from "./services.js";

import type { RecieverType } from "./receiver.js";

const Receiver: RecieverType = { name: "Receiver" };

REGISTRY.addService(
  restate.service({
    name: "Coordinator",
    handlers: {
      sleep(ctx: restate.Context, request: number): Promise<void> {
        return this.manyTimers(ctx, [request]);
      },

      manyTimers: async (
        ctx: restate.Context,
        request: Array<number>
      ): Promise<void> => {
        console.log("many timers: " + JSON.stringify(request));

        await restate.CombineablePromise.all(
          request.map((value) => ctx.sleep(value))
        );
      },

      async proxy(ctx: restate.Context): Promise<string> {
        console.log("proxy");

        const uuid = ctx.rand.uuidv4();

        const pong = await ctx.objectClient(Receiver, uuid).ping();

        return pong;
      },

      async complex(
        ctx: restate.Context,
        request: { sleepDurationMillis: number; requestValue: string }
      ): Promise<string> {
        console.log("complex: ", request);

        const sleepDuration = request.sleepDurationMillis;
        if (sleepDuration === undefined) {
          throw new Error("Expecting sleepDuration to be non null");
        }
        await ctx.sleep(sleepDuration);

        const key = ctx.rand.uuidv4();

        // Functions should be invoked in the same order they were called. This means that
        // background calls as well as request-response calls have an absolute ordering that is defined
        // by their call order. In this concrete case, setValue is guaranteed to be executed before
        // getValue.
        ctx.objectSendClient(Receiver, key).setValue(request.requestValue);
        return ctx.objectClient(Receiver, key).getValue();
      },

      async timeout(ctx: restate.Context, millis: number): Promise<boolean> {
        let timeoutOccurred = false;

        try {
          await ctx.awakeable<string>().promise.orTimeout(millis);
        } catch (e) {
          if (e instanceof TimeoutError) {
            timeoutOccurred = true;
          }
        }

        return timeoutOccurred;
      },

      invokeSequentially() {
        throw new Error("Method not implemented.");
      },
    },
  })
);
