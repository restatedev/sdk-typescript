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

import { describe, expect, test, vi } from "vitest";

vi.mock("node:dns", () => ({
  promises: {
    resolveSrv: vi.fn(),
  },
}));

import * as dns from "node:dns";
import { resolveTargets } from "../src/targets.js";

const resolveSrv = vi.mocked(dns.promises.resolveSrv);

describe("resolveTargets — region / SRV", () => {
  test("orders by priority then weight, and pins servername to the SRV query name", async () => {
    resolveSrv.mockResolvedValueOnce([
      { name: "node-b.tunnel.internal", port: 19081, priority: 10, weight: 1 },
      { name: "node-a.tunnel.internal", port: 19080, priority: 0, weight: 5 },
      { name: "node-c.tunnel.internal", port: 19082, priority: 0, weight: 9 },
    ]);
    const targets = await resolveTargets({ region: "us" });
    expect(resolveSrv).toHaveBeenCalledWith("tunnel.us.restate.cloud");
    // priority asc, then weight desc.
    expect(targets.map((t) => t.host)).toEqual([
      "node-c.tunnel.internal",
      "node-a.tunnel.internal",
      "node-b.tunnel.internal",
    ]);
    expect(targets.map((t) => t.port)).toEqual([19082, 19080, 19081]);
    // TLS verification name is the SRV QUERY name for EVERY target (the
    // cloud's cert covers tunnel.<region>.restate.cloud, not per-node
    // hostnames) — mirrors the Rust client's FixedServerNameResolver.
    for (const t of targets) {
      expect(t.servername).toBe("tunnel.us.restate.cloud");
    }
  });

  test("empty SRV answer throws", async () => {
    resolveSrv.mockResolvedValueOnce([]);
    await expect(resolveTargets({ region: "eu" })).rejects.toThrow(
      /no records/
    );
  });

  test("explicit tunnelServers bypass DNS entirely", async () => {
    resolveSrv.mockClear();
    const targets = await resolveTargets({
      tunnelServers: ["a.example:1000", "https://b.example"],
    });
    expect(resolveSrv).not.toHaveBeenCalled();
    expect(targets.map((t) => t.host)).toEqual(["a.example", "b.example"]);
  });
});
