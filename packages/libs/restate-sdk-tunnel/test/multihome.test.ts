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

// Multi-homing: like the Rust client, the engine holds one tunnel
// connection per resolved tunnel server, with per-slot reconnect loops and
// DNS-driven reconciliation (servers appear → slots start; vanish → slots
// torn down). A fatal on any slot stops the whole tunnel (shared creds).

import { describe, expect, test, vi } from "vitest";

vi.mock("node:dns", () => ({
  promises: {
    resolveSrv: vi.fn(),
    lookup: vi.fn(),
  },
}));

import * as dns from "node:dns";
import * as restate from "@restatedev/restate-sdk";

import { connectTunnel } from "../src/index.js";
import type { ConnectTunnelOptions } from "../src/index.js";
import { startFakeCloud, roundtrip } from "./fake-cloud.js";
import { generateIdentityKey } from "./identity.js";

const identity = generateIdentityKey();

const greeter = restate.service({
  name: "greeter",
  handlers: {
    greet: async (_ctx: restate.Context, name: string) => `Hello ${name}`,
  },
});

const TUNNEL_NAME = "test-tunnel";

const okTrailers = (): Record<string, string> => ({
  "tunnel-status": "ok",
  "proxy-url": `https://tunnel.example:9080/abc123/${TUNNEL_NAME}`,
  "tunnel-url": "https://tunnel.example:9080",
  "tunnel-name": TUNNEL_NAME,
});

const baseOptions = (servers: string[]): ConnectTunnelOptions => ({
  tunnelServers: servers,
  environmentId: "env_abc123",
  authToken: "key_test.secret",
  signingPublicKey: identity.publicKey,
  tunnelName: TUNNEL_NAME,
  services: [greeter],
  handshakeTimeoutMs: 300,
  reconnectInitialMs: 5,
  reconnectMaxMs: 200,
});

const DISCOVER_ACCEPT = "application/vnd.restate.endpointmanifest.v2+json";

const signedDiscover = {
  ":method": "GET",
  ":path": "/http/h/9080/discover",
  accept: DISCOVER_ACCEPT,
  "x-restate-signature-scheme": "v1",
  "x-restate-jwt-v1": identity.sign("/discover"),
};

async function until(
  cond: () => boolean,
  timeoutMs = 2_000,
  what = "condition"
): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("multi-homing — explicit servers", () => {
  test("connects to EVERY configured server and serves on each", async () => {
    const fake1 = await startFakeCloud({ decideTrailers: () => okTrailers() });
    const fake2 = await startFakeCloud({ decideTrailers: () => okTrailers() });
    const conn = connectTunnel(
      baseOptions([
        `http://127.0.0.1:${fake1.port}`,
        `http://127.0.0.1:${fake2.port}`,
      ])
    );
    try {
      await conn.ready;
      await until(() => conn.connectionCount === 2, 2_000, "both handshakes");
      expect(fake1.connections.length).toBe(1);
      expect(fake2.connections.length).toBe(1);
      // Both connections serve independently.
      for (const fake of [fake1, fake2]) {
        const { status, body } = await roundtrip(
          (await fake.waitForConnection(0)).session,
          signedDiscover
        );
        expect(status).toBe(200);
        expect(body).toContain("greeter");
      }
    } finally {
      await conn.close();
      await fake1.close();
      await fake2.close();
    }
  });

  test("one server dying redials only that slot", async () => {
    const fake1 = await startFakeCloud({ decideTrailers: () => okTrailers() });
    const fake2 = await startFakeCloud({ decideTrailers: () => okTrailers() });
    const conn = connectTunnel(
      baseOptions([
        `http://127.0.0.1:${fake1.port}`,
        `http://127.0.0.1:${fake2.port}`,
      ])
    );
    try {
      await until(() => conn.connectionCount === 2, 2_000, "both handshakes");
      (await fake1.waitForConnection(0)).session.destroy();
      await fake1.waitForConnection(1); // that slot redialed
      await until(() => conn.connectionCount === 3, 2_000, "redial handshake");
      expect(fake2.connections.length).toBe(1); // untouched
    } finally {
      await conn.close();
      await fake1.close();
      await fake2.close();
    }
  });

  test("a fatal on one slot stops the WHOLE tunnel (shared credentials)", async () => {
    const fake1 = await startFakeCloud({ decideTrailers: () => okTrailers() });
    const fake2 = await startFakeCloud({
      decideTrailers: () => ({ "tunnel-status": "unauthorized" }),
    });
    const conn = connectTunnel(
      baseOptions([
        `http://127.0.0.1:${fake1.port}`,
        `http://127.0.0.1:${fake2.port}`,
      ])
    );
    try {
      await until(() => conn.error !== undefined, 2_000, "fatal surfaced");
      expect(conn.error?.message).toMatch(/unauthorized/);
      // The healthy slot is torn down too — same creds would hit the same wall.
      await until(
        () =>
          fake1.connections.length === 0 ||
          fake1.connections[0]!.session.destroyed,
        2_000,
        "healthy slot torn down"
      );
      const seen1 = fake1.connections.length;
      const seen2 = fake2.connections.length;
      await new Promise((r) => setTimeout(r, 150));
      expect(fake1.connections.length).toBe(seen1); // no more dials anywhere
      expect(fake2.connections.length).toBe(seen2);
    } finally {
      await conn.close();
      await fake1.close();
      await fake2.close();
    }
  });
});

describe("multi-homing — DNS reconciliation (region mode)", () => {
  test("servers appearing get connections; vanished servers are torn down", async () => {
    const fake1 = await startFakeCloud({ decideTrailers: () => okTrailers() });
    const fake2 = await startFakeCloud({ decideTrailers: () => okTrailers() });

    // Mutable "DNS": SRV record names map to fake ports; lookup resolves
    // every name to loopback. The engine re-resolves on resolveIntervalMs.
    let current: Array<{ name: string; port: number }> = [
      { name: "node-1.tunnel.internal", port: fake1.port },
    ];
    vi.mocked(dns.promises.resolveSrv).mockImplementation(() =>
      Promise.resolve(current.map((s) => ({ ...s, priority: 0, weight: 1 })))
    );
    vi.mocked(dns.promises.lookup).mockImplementation(() =>
      Promise.resolve([{ address: "127.0.0.1", family: 4 }] as never)
    );

    const logs: string[] = [];
    const { tunnelServers: _drop, ...opts } = baseOptions([]);
    const conn = connectTunnel({
      ...opts,
      region: "us",
      tls: false, // plaintext fakes; region targets follow the global tls option
      resolveIntervalMs: 60,
      tunnelDiagnosticLogger: (m) => logs.push(m),
    });
    try {
      await conn.ready;
      expect(fake1.connections.length).toBe(1);

      // A second server appears in DNS → it gets a connection.
      current = [
        { name: "node-1.tunnel.internal", port: fake1.port },
        { name: "node-2.tunnel.internal", port: fake2.port },
      ];
      await fake2.waitForConnection(0);
      await until(() => conn.connectionCount === 2, 2_000, "second handshake");
      expect(logs.join("\n")).toContain(
        `tunnel: discovered new tunnel target(s): 127.0.0.1:${fake2.port}`
      );

      // The first server vanishes from DNS → its slot is torn down.
      current = [{ name: "node-2.tunnel.internal", port: fake2.port }];
      await until(
        () => fake1.connections[0]!.session.destroyed,
        2_000,
        "vanished server torn down"
      );
      expect(fake2.connections[0]!.session.destroyed).toBe(false);
      expect(logs.join("\n")).toContain(
        `tunnel: tunnel target(s) disappeared: 127.0.0.1:${fake1.port}`
      );
    } finally {
      await conn.close();
      await fake1.close();
      await fake2.close();
    }
  });

  test("resolution failure keeps existing slots serving; recovery reconciles", async () => {
    const fake1 = await startFakeCloud({ decideTrailers: () => okTrailers() });
    const fake2 = await startFakeCloud({ decideTrailers: () => okTrailers() });

    let failResolution = false;
    let current: Array<{ name: string; port: number }> = [
      { name: "node-1.tunnel.internal", port: fake1.port },
    ];
    vi.mocked(dns.promises.resolveSrv).mockImplementation(() =>
      failResolution
        ? Promise.reject(new Error("SERVFAIL"))
        : Promise.resolve(
            current.map((s) => ({ ...s, priority: 0, weight: 1 }))
          )
    );
    vi.mocked(dns.promises.lookup).mockImplementation(() =>
      Promise.resolve([{ address: "127.0.0.1", family: 4 }] as never)
    );

    const { tunnelServers: _drop, ...opts } = baseOptions([]);
    const conn = connectTunnel({
      ...opts,
      region: "us",
      tls: false,
      resolveIntervalMs: 40,
    });
    try {
      await conn.ready;
      const c0 = await fake1.waitForConnection(0);

      // DNS goes dark: the established connection must keep serving.
      failResolution = true;
      await new Promise((r) => setTimeout(r, 200)); // several failed cycles
      expect(c0.session.destroyed).toBe(false);
      const { status } = await roundtrip(c0.session, signedDiscover);
      expect(status).toBe(200);

      // DNS recovers with an extra server: reconciliation resumes.
      current = [
        { name: "node-1.tunnel.internal", port: fake1.port },
        { name: "node-2.tunnel.internal", port: fake2.port },
      ];
      failResolution = false;
      await fake2.waitForConnection(0);
      expect(c0.session.destroyed).toBe(false);
    } finally {
      await conn.close();
      await fake1.close();
      await fake2.close();
    }
  });

  test("a transient lookup failure (EAI_AGAIN) does not tear down a healthy slot", async () => {
    const fake1 = await startFakeCloud({ decideTrailers: () => okTrailers() });

    let flaky = false;
    vi.mocked(dns.promises.resolveSrv).mockImplementation(() =>
      Promise.resolve([
        {
          name: "node-1.tunnel.internal",
          port: fake1.port,
          priority: 0,
          weight: 1,
        },
      ])
    );
    vi.mocked(dns.promises.lookup).mockImplementation(() =>
      flaky
        ? Promise.reject(
            Object.assign(new Error("temporary failure"), { code: "EAI_AGAIN" })
          )
        : Promise.resolve([{ address: "127.0.0.1", family: 4 }] as never)
    );

    const { tunnelServers: _drop, ...opts } = baseOptions([]);
    const conn = connectTunnel({
      ...opts,
      region: "us",
      tls: false,
      resolveIntervalMs: 40,
    });
    try {
      await conn.ready;
      const c0 = await fake1.waitForConnection(0);
      flaky = true; // resolver blips — must NOT shrink the desired set
      await new Promise((r) => setTimeout(r, 200));
      expect(c0.session.destroyed).toBe(false);
      expect(fake1.connections.length).toBe(1); // no churn either
    } finally {
      await conn.close();
      await fake1.close();
    }
  });

  test("a fatal in region mode stops the re-resolve supervisor", async () => {
    const fake1 = await startFakeCloud({ decideTrailers: () => okTrailers() });
    const fake2 = await startFakeCloud({
      decideTrailers: () => ({ "tunnel-status": "unauthorized" }),
    });

    vi.mocked(dns.promises.resolveSrv).mockImplementation(() =>
      Promise.resolve([
        {
          name: "node-1.tunnel.internal",
          port: fake1.port,
          priority: 0,
          weight: 1,
        },
        {
          name: "node-2.tunnel.internal",
          port: fake2.port,
          priority: 0,
          weight: 1,
        },
      ])
    );
    vi.mocked(dns.promises.lookup).mockImplementation(() =>
      Promise.resolve([{ address: "127.0.0.1", family: 4 }] as never)
    );

    const { tunnelServers: _drop, ...opts } = baseOptions([]);
    const conn = connectTunnel({
      ...opts,
      region: "us",
      tls: false,
      resolveIntervalMs: 40,
    });
    try {
      await until(() => conn.error !== undefined, 2_000, "fatal surfaced");
      const resolveCalls = vi.mocked(dns.promises.resolveSrv).mock.calls.length;
      const seen1 = fake1.connections.length;
      await new Promise((r) => setTimeout(r, 200)); // several would-be intervals
      // The supervisor stopped: no more resolutions, no more dials.
      expect(vi.mocked(dns.promises.resolveSrv).mock.calls.length).toBe(
        resolveCalls
      );
      expect(fake1.connections.length).toBe(seen1);
      const closed = conn.close();
      await closed; // and close() is prompt
    } finally {
      await conn.close();
      await fake1.close();
      await fake2.close();
    }
  });

  test("close() is prompt even while a resolution is in flight", async () => {
    // The DNS APIs are un-abortable; the supervisor races them against the
    // wake signal so close() doesn't block on a slow resolver.
    let resolveStarted!: () => void;
    const started = new Promise<void>((r) => (resolveStarted = r));
    vi.mocked(dns.promises.resolveSrv).mockImplementation(() => {
      resolveStarted();
      return new Promise(() => {}); // never settles
    });

    const { tunnelServers: _drop, ...opts } = baseOptions([]);
    const conn = connectTunnel({ ...opts, region: "us", tls: false });
    await started; // supervisor is now stuck inside resolveTargets
    const t0 = Date.now();
    await conn.close();
    expect(Date.now() - t0).toBeLessThan(500);
    await expect(conn.ready).rejects.toThrow(/closed/);
  });
});
