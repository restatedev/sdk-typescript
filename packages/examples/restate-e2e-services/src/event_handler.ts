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
import type { CounterApi } from "./counter.js";

const EventHandlerFQN = "EventHandler";

const CounterApi: CounterApi = { name: "Counter" };

const o = restate.service({
  name: EventHandlerFQN,
  handlers: {
    handle(ctx: restate.Context, request: { id: string; value: number }) {
      ctx.objectSendClient(CounterApi, request.id).add(request.value);
      return Promise.resolve();
    },
  },
});

REGISTRY.addObject(o);
