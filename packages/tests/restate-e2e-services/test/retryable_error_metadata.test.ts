// Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
//
// This file is part of the Restate e2e tests,
// which are released under the MIT license.
//
// You can find a copy of the license in file LICENSE in the root
// directory of this repository or package, or at
// https://github.com/restatedev/e2e/blob/main/LICENSE

import { describe, it, expect } from "vitest";
import { ingressClient } from "./utils.js";
import type { RetryableErrorMetadata } from "../src/retryable_error_metadata.js";

const RetryableErrorMetadata: RetryableErrorMetadata = {
  name: "RetryableErrorMetadata",
};

describe("RetryableErrorMetadata", () => {
  const ingress = ingressClient();

  it("ctx.run propagates RetryableError code and metadata to the TerminalError when retries are exhausted", async () => {
    const result = await ingress
      .serviceClient(RetryableErrorMetadata)
      .runExhaustingRetries();

    expect(result).toEqual({
      code: 503,
      message: "always fails",
      metadata: { source: "run-closure", attempt: "last" },
    });
  }, 30_000);
});
