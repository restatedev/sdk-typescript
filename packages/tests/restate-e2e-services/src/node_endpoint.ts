// Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
//
// This file is part of the Restate e2e tests,
// which are released under the MIT license.
//
// You can find a copy of the license in file LICENSE in the root
// directory of this repository or package, or at
// https://github.com/restatedev/e2e/blob/main/LICENSE

import { setTimeout } from "node:timers/promises";
import * as restate from "@restatedev/restate-sdk";
import { REGISTRY } from "./services.js";

type DelayOutsideRunRequest = {
  delayMillis?: number;
};

type DelayOutsideRunResponse = {
  attempt: number;
};

const attempts = new Map<string, number>();

async function delayOutsideRun(
  ctx: restate.Context,
  input: DelayOutsideRunRequest
): Promise<DelayOutsideRunResponse> {
  const delayMillis = input.delayMillis ?? 500;
  const invocationId = ctx.request().id;
  const attempt = (attempts.get(invocationId) ?? 0) + 1;
  attempts.set(invocationId, attempt);

  await setTimeout(delayMillis);

  return {
    attempt,
  };
}

const nodeEndpointService = restate.service({
  name: "NodeEndpoint",
  handlers: {
    delayOutsideRun: restate.handlers.handler(
      {
        retryPolicy: {
          initialInterval: 250,
          maxAttempts: 1,
          onMaxAttempts: "kill",
        },
      },
      delayOutsideRun
    ),
  },
});

REGISTRY.addService(nodeEndpointService);

export type NodeEndpoint = typeof nodeEndpointService;
