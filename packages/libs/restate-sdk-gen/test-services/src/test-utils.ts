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
  serdes,
  handlerRequest,
  cancel,
  run,
  invocation,
} from "@restatedev/restate-sdk-gen";

export const testUtilsService = service({
  name: "TestUtilsService",
  handlers: {
    *echo(input: string) {
      return input;
    },

    *uppercaseEcho(input: string) {
      return input.toUpperCase();
    },

    *echoHeaders() {
      const out: Record<string, string> = {};
      for (const [k, v] of handlerRequest().headers) out[k] = v;
      return out;
    },

    rawEcho: serdes(
      { input: restate.serde.binary, output: restate.serde.binary },
      function* (input: Uint8Array) {
        return input;
      }
    ),

    *countExecutedSideEffects(increments: number) {
      let invokedSideEffects = 0;
      for (let i = 0; i < increments; i++) {
        yield* run(
          async () => {
            invokedSideEffects += 1;
          },
          { name: "count" }
        );
      }
      return invokedSideEffects;
    },

    *cancelInvocation(invocationId: string) {
      cancel(invocationId as restate.InvocationId);
    },

    *resolveSignal(req: {
      invocationId: string;
      signalName: string;
      value: string;
    }) {
      invocation(req.invocationId).signal(req.signalName).resolve(req.value);
    },

    *rejectSignal(req: {
      invocationId: string;
      signalName: string;
      reason: string;
    }) {
      invocation(req.invocationId).signal(req.signalName).reject(req.reason);
    },
  },
});
