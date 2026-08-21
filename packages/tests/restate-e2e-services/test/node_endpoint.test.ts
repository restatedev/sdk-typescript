// Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
//
// This file is part of the Restate e2e tests,
// which are released under the MIT license.
//
// You can find a copy of the license in file LICENSE in the root
// directory of this repository or package, or at
// https://github.com/restatedev/e2e/blob/main/LICENSE

import { describe, expect, it } from "vitest";
import { ingressClient } from "./utils.js";
import type { NodeEndpoint } from "../src/node_endpoint.js";

const nodeEndpoint: NodeEndpoint = {
  name: "NodeEndpoint",
};

describe("Node endpoint request lifecycle", () => {
  const ingress = ingressClient();

  it("does not restart when async work outside ctx.run", async () => {
    const result = await ingress
      .serviceClient(nodeEndpoint)
      .delayOutsideRun({ delayMillis: 500 });

    expect(result).toEqual({ attempt: 1 });
  }, 5_000);
});
