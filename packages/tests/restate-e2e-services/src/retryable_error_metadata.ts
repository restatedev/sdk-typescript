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

export interface CaughtTerminalError {
  code: number;
  message: string;
  metadata: Record<string, string>;
}

const retryableErrorMetadataService = restate.service({
  name: "RetryableErrorMetadata",
  handlers: {
    /**
     * Throws a RetryableError (without retryAfter, so the RunOptions policy applies)
     * carrying errorCode and metadata, until maxRetryAttempts is reached.
     * Returns the TerminalError thrown by ctx.run once retries are exhausted.
     */
    runExhaustingRetries: async (
      ctx: restate.Context
    ): Promise<CaughtTerminalError> => {
      try {
        await ctx.run(
          "always-fails",
          () => {
            throw new restate.RetryableError("always fails", {
              errorCode: 503,
              metadata: { source: "run-closure", attempt: "last" },
            });
          },
          { maxRetryAttempts: 2, initialRetryInterval: 10 }
        );
      } catch (e) {
        if (e instanceof restate.TerminalError) {
          return {
            code: e.code,
            message: e.message,
            metadata: e.metadata ?? {},
          };
        }
        throw e;
      }
      throw new restate.TerminalError("ctx.run unexpectedly succeeded");
    },
  },
});

export type RetryableErrorMetadata = typeof retryableErrorMetadataService;

REGISTRY.addService(retryableErrorMetadataService);
