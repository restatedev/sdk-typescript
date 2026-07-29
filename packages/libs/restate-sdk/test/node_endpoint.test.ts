/*
 * Copyright (c) 2023-2024 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

import { once } from "node:events";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { abortSignalForRequest } from "../src/endpoint/node_endpoint.js";

describe("abortSignalForRequest", () => {
  it("aborts when the request closes before it has fully ended", async () => {
    const request = Readable.from(["data"]); // left unconsumed
    const signal = abortSignalForRequest(request);

    request.destroy();
    await once(request, "close");

    expect(request.readableEnded).toBe(false);
    expect(signal.aborted).toBe(true);
  });

  it("does not abort when the request closes after it has fully ended", async () => {
    const request = Readable.from(["data"]);
    const signal = abortSignalForRequest(request);

    request.resume(); // consume to completion
    await once(request, "close");

    expect(request.readableEnded).toBe(true);
    expect(signal.aborted).toBe(false);
  });
});
