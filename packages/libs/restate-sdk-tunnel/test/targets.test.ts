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

import { describe, expect, test, vi, beforeEach } from "vitest";

vi.mock("node:dns", () => ({
  promises: {
    resolveSrv: vi.fn(),
    lookup: vi.fn(),
  },
}));

import * as dns from "node:dns";
import { resolveTargets, targetKey } from "../src/targets.js";

const resolveSrv = vi.mocked(dns.promises.resolveSrv);
const lookup = vi.mocked(dns.promises.lookup);

beforeEach(() => {
  resolveSrv.mockReset();
  lookup.mockReset();
});

describe("resolveTargets — region / SRV", () => {
  test("expands every SRV target to all of its addresses (one connection per IP)", async () => {
    resolveSrv.mockResolvedValueOnce([
      { name: "node-b.tunnel.internal", port: 19081, priority: 10, weight: 1 },
      { name: "node-a.tunnel.internal", port: 19080, priority: 0, weight: 5 },
    ]);
    lookup.mockImplementation(((name: string) =>
      Promise.resolve(
        name === "node-a.tunnel.internal"
          ? [
              { address: "10.0.0.1", family: 4 },
              { address: "10.0.0.2", family: 4 },
            ]
          : [{ address: "10.0.1.1", family: 4 }]
      )) as never);
    const targets = await resolveTargets({
      srvName: "tunnel.us.restate.cloud",
    });
    expect(resolveSrv).toHaveBeenCalledWith("tunnel.us.restate.cloud");
    // priority asc — node-a's addresses first — then node-b's.
    expect(targets.map(targetKey)).toEqual([
      "10.0.0.1:19080",
      "10.0.0.2:19080",
      "10.0.1.1:19081",
    ]);
    // TLS verification name is the SRV QUERY name for EVERY target (the
    // cloud's cert covers tunnel.<region>.restate.cloud, not per-node
    // hostnames) — mirrors the Rust client's FixedServerNameResolver.
    for (const t of targets) {
      expect(t.servername).toBe("tunnel.us.restate.cloud");
    }
  });

  test("a NEGATIVE answer (ENOTFOUND) removes that target; the others still serve", async () => {
    resolveSrv.mockResolvedValueOnce([
      { name: "alive.internal", port: 1000, priority: 0, weight: 1 },
      { name: "dead.internal", port: 1001, priority: 0, weight: 1 },
    ]);
    lookup.mockImplementation(((name: string) =>
      name === "dead.internal"
        ? Promise.reject(
            Object.assign(new Error("not found"), { code: "ENOTFOUND" })
          )
        : Promise.resolve([{ address: "10.0.0.9", family: 4 }])) as never);
    const targets = await resolveTargets({ srvName: "tunnel.eu.example" });
    expect(targets.map(targetKey)).toEqual(["10.0.0.9:1000"]);
  });

  test("a TRANSPORT error (EAI_AGAIN) fails the whole resolution — healthy slots must not be torn down over a resolver blip", async () => {
    const logs: string[] = [];
    resolveSrv.mockResolvedValueOnce([
      { name: "alive.internal", port: 1000, priority: 0, weight: 1 },
      { name: "flaky.internal", port: 1001, priority: 0, weight: 1 },
    ]);
    lookup.mockImplementation(((name: string) =>
      name === "flaky.internal"
        ? Promise.reject(
            Object.assign(new Error("temporary failure"), {
              code: "EAI_AGAIN",
            })
          )
        : Promise.resolve([{ address: "10.0.0.9", family: 4 }])) as never);
    await expect(
      resolveTargets({
        srvName: "tunnel.eu.example",
        logger: (m) => logs.push(m),
      })
    ).rejects.toThrow(/temporary failure/);
    expect(logs.join("\n")).toContain(
      "tunnel: address lookup for SRV target flaky.internal:1001 failed: temporary failure"
    );
  });

  test("all-negative answers yield an EMPTY set (everything reconciled away, like Rust)", async () => {
    resolveSrv.mockResolvedValueOnce([
      { name: "dead.internal", port: 1001, priority: 0, weight: 1 },
    ]);
    lookup.mockRejectedValue(
      Object.assign(new Error("not found"), { code: "ENOTFOUND" })
    );
    await expect(
      resolveTargets({ srvName: "tunnel.eu.example" })
    ).resolves.toEqual([]);
  });

  test("empty SRV answer yields an empty set", async () => {
    resolveSrv.mockResolvedValueOnce([]);
    await expect(
      resolveTargets({ srvName: "tunnel.eu.example" })
    ).resolves.toEqual([]);
  });

  test("explicit tunnelServers bypass DNS entirely (one target per entry)", async () => {
    const targets = await resolveTargets({
      tunnelServers: ["a.example:1000", "https://b.example"],
    });
    expect(resolveSrv).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
    expect(targets.map((t) => t.host)).toEqual(["a.example", "b.example"]);
  });
});
