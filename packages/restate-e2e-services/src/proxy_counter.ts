// Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
//
// This file is part of the Restate e2e tests,
// which are released under the MIT license.
//
// You can find a copy of the license in file LICENSE in the root
// directory of this repository or package, or at
// https://github.com/restatedev/e2e/blob/main/LICENSE

import * as restate from "@restatedev/restate-sdk";
import { REGISTRY } from "./services.js";
import { CounterApi } from "./counter.js";

const ProxyCounterServiceFQN = "ProxyCounter";
const Counter: CounterApi = { name: "Counter" };

const service = restate.service({
  name: ProxyCounterServiceFQN,
  handlers: {
    async addInBackground(
      ctx: restate.Context,
      request: { counterName: string; value: number }
    ) {
      ctx.console.log("addInBackground " + JSON.stringify(request));
      ctx.objectSendClient(Counter, request.counterName).add(request.value);
    },
  },
});

REGISTRY.addService(service);
