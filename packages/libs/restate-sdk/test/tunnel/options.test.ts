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

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  resolveOptions,
  buildTlsConnectOptions,
  srvNameForRegionDomain,
  TUNNEL_WORKER_ID_ENV,
} from "../../src/endpoint/tunnel/options.js";
import { parseServerAddress } from "../../src/endpoint/tunnel/targets.js";
import type { EngineOptions } from "../../src/endpoint/tunnel/types.js";

const valid: EngineOptions = {
  discovery: { srvName: "tunnel.us.restate.cloud" },
  environmentId: "env_abc123",
  authToken: () => "key_xyz.secret",
  identityKeys: ["publickeyv1_AfQwmwfgEZhrWpvv8N52SHpRtZqGGaFr4AZN6qtYWSiY"],
  name: "my-deployment",
  services: [],
};

let savedWorkerId: string | undefined;
beforeEach(() => {
  savedWorkerId = process.env[TUNNEL_WORKER_ID_ENV];
  delete process.env[TUNNEL_WORKER_ID_ENV];
});
afterEach(() => {
  if (savedWorkerId === undefined) delete process.env[TUNNEL_WORKER_ID_ENV];
  else process.env[TUNNEL_WORKER_ID_ENV] = savedWorkerId;
});

describe("resolveOptions — validation", () => {
  test("accepts a valid config and applies defaults", () => {
    const r = resolveOptions(valid);
    expect(r.srvName).toBe("tunnel.us.restate.cloud");
    expect(r.tunnelServers).toBeUndefined();
    expect(r.name).toBe("my-deployment");
    expect(r.identityKeys).toEqual(valid.identityKeys);
    expect(r.authToken()).toBe("key_xyz.secret");
    expect(r.bidirectional).toBe(true);
    expect(r.connectTimeoutMs).toBe(5_000);
    expect(r.handshakeTimeoutMs).toBe(5_000);
    expect(r.reconnectInitialMs).toBe(10);
    expect(r.reconnectMaxMs).toBe(120_000);
    expect(r.reconnectFactor).toBe(2);
    expect(r.reconnectMaxAttempts).toBeUndefined();
    expect(r.reconnectMaxDurationMs).toBeUndefined();
    expect(r.pingIntervalMs).toBe(75_000);
    expect(r.maxConcurrentStreams).toBe(4096);
    expect(r.connectionWindowSize).toBe(16 * 1024 * 1024);
    expect(r.maxSessionMemory).toBe(256);
    expect(r.tls).toBe(true);
    expect(r.tunnelWorkerId).toMatch(/^[\x21-\x7e]+$/);
  });

  test("accepts Duration reconnect intervals, resolving them to milliseconds", () => {
    const r = resolveOptions({
      ...valid,
      reconnectRetryPolicy: {
        initialInterval: { seconds: 1 },
        maxInterval: { seconds: 30 },
        exponentiationFactor: 3,
      },
    });
    expect(r.reconnectInitialMs).toBe(1000);
    expect(r.reconnectMaxMs).toBe(30_000);
    expect(r.reconnectFactor).toBe(3);
    const bounded = resolveOptions({
      ...valid,
      reconnectRetryPolicy: { maxAttempts: 3, maxDuration: { seconds: 2 } },
    });
    expect(bounded.reconnectMaxAttempts).toBe(3);
    expect(bounded.reconnectMaxDurationMs).toBe(2000);
    expect(
      resolveOptions({
        ...valid,
        reconnectRetryPolicy: { maxAttempts: false, maxDuration: false },
      }).reconnectMaxAttempts
    ).toBeUndefined();
    expect(() =>
      resolveOptions({ ...valid, reconnectRetryPolicy: { maxAttempts: 0 } })
    ).toThrow(/positive/);
  });

  test("explicit servers are parsed eagerly; a malformed entry or an empty list throws (not a retry loop)", () => {
    // Left to the supervisor, a parse error would look like a transient
    // resolution failure and retry forever without ever connecting.
    expect(
      resolveOptions({
        ...valid,
        discovery: { servers: ["good.example:9080"] },
      }).tunnelServers
    ).toEqual(["good.example:9080"]);
    expect(() =>
      resolveOptions({
        ...valid,
        discovery: { servers: ["good.example:9080", "no-port"] },
      })
    ).toThrow(/invalid tunnel server address/);
    expect(() =>
      resolveOptions({ ...valid, discovery: { servers: [] } })
    ).toThrow(/must not be empty/);
    expect(() =>
      resolveOptions({ ...valid, discovery: { srvName: "bad/srv" } })
    ).toThrow(/invalid serversSrv/);
  });

  test("workerId: explicit > RESTATE_TUNNEL_WORKER_ID > generated; header-hostile values rejected", () => {
    process.env[TUNNEL_WORKER_ID_ENV] = "worker-from-env";
    expect(resolveOptions(valid).tunnelWorkerId).toBe("worker-from-env");
    expect(
      resolveOptions({ ...valid, workerId: "worker-explicit" }).tunnelWorkerId
    ).toBe("worker-explicit");
    expect(() => resolveOptions({ ...valid, workerId: "worker id" })).toThrow(
      /HTTP header/
    );
    expect(() => resolveOptions({ ...valid, workerId: "worker\nid" })).toThrow(
      /HTTP header/
    );
  });

  test("rejects non-positive numeric options", () => {
    expect(() =>
      resolveOptions({ ...valid, reconnectRetryPolicy: { initialInterval: 0 } })
    ).toThrow(/positive/);
    expect(() => resolveOptions({ ...valid, pingIntervalMs: -5 })).toThrow(
      /positive/
    );
  });
});

describe("buildTlsConnectOptions — the ALPN invariant", () => {
  test("always offers exactly ['h2'] (same offer as the Rust client)", () => {
    // The connection layer REQUIRES the negotiation to succeed; dropping or
    // widening the offer would silently change which servers we can talk to.
    for (const tlsOption of [
      true,
      { ca: "ca-pem" },
      { cert: "c", key: "k", rejectUnauthorized: false },
    ] as const) {
      const built = buildTlsConnectOptions(tlsOption, "host.example");
      expect(built).toBeDefined();
      expect(built!.ALPNProtocols).toEqual(["h2"]);
    }
  });

  test("tls: false means plaintext (undefined options)", () => {
    expect(buildTlsConnectOptions(false, "host")).toBeUndefined();
  });

  test("servername defaults to the dialed host and can be overridden", () => {
    expect(buildTlsConnectOptions(true, "a.example")!.servername).toBe(
      "a.example"
    );
    expect(
      buildTlsConnectOptions({ servername: "sni.example" }, "a.example")!
        .servername
    ).toBe("sni.example");
  });
});

describe("srvNameForRegionDomain", () => {
  test("prefixes the region domain with tunnel.", () => {
    expect(srvNameForRegionDomain("us.restate.cloud")).toBe(
      "tunnel.us.restate.cloud"
    );
    expect(srvNameForRegionDomain("abc.byoc.restate.cloud")).toBe(
      "tunnel.abc.byoc.restate.cloud"
    );
  });
});

describe("parseServerAddress", () => {
  test("host:port", () => {
    expect(parseServerAddress("tunnel.example:9080")).toEqual({
      host: "tunnel.example",
      port: 9080,
      servername: "tunnel.example",
    });
  });

  test("https URL implies TLS with default port 443", () => {
    expect(parseServerAddress("https://tunnel.example")).toEqual({
      host: "tunnel.example",
      port: 443,
      servername: "tunnel.example",
      plaintext: false,
    });
  });

  test("http URL implies plaintext for that server", () => {
    expect(parseServerAddress("http://127.0.0.1:19080")).toEqual({
      host: "127.0.0.1",
      port: 19080,
      servername: "127.0.0.1",
      plaintext: true,
    });
  });

  test("rejects malformed addresses", () => {
    expect(() => parseServerAddress("no-port")).toThrow(/invalid/);
    expect(() => parseServerAddress("host:notaport")).toThrow(/invalid port/);
    expect(() => parseServerAddress("ftp://x:1")).toThrow(/unsupported/);
    expect(() => parseServerAddress("https://x:1/path")).toThrow(
      /must not have a path/
    );
  });
});

describe("client-drain / graceful-shutdown options", () => {
  test("startupReady is optional and can be promise- or callback-backed", async () => {
    expect(resolveOptions(valid).startupReady).toBeUndefined();
    expect(resolveOptions(valid).startupReadyTimeoutMs).toBe(120_000);
    await expect(
      resolveOptions({
        ...valid,
        startupReady: Promise.resolve(),
      }).startupReady?.()
    ).resolves.toBeUndefined();
    await expect(
      resolveOptions({
        ...valid,
        startupReady: () => Promise.resolve(),
      }).startupReady?.()
    ).resolves.toBeUndefined();
    expect(
      resolveOptions({ ...valid, startupReadyTimeoutMs: 5_000 })
        .startupReadyTimeoutMs
    ).toBe(5_000);
    expect(() =>
      resolveOptions({ ...valid, startupReadyTimeoutMs: 0 })
    ).toThrow(/startupReadyTimeoutMs must be a positive number/);
  });

  test("supportsClientDrain defaults to true and can be disabled", () => {
    expect(resolveOptions(valid).supportsClientDrain).toBe(true);
    expect(
      resolveOptions({ ...valid, supportsClientDrain: false })
        .supportsClientDrain
    ).toBe(false);
  });

  test("gracefulShutdown: on by default (SIGTERM, drain grace); true/object/false forms", () => {
    expect(resolveOptions(valid).gracefulShutdown).toEqual({
      signals: ["SIGTERM"],
      graceMs: 120_000,
    });
    expect(
      resolveOptions({ ...valid, gracefulShutdown: false }).gracefulShutdown
    ).toBeUndefined();
    expect(
      resolveOptions({ ...valid, gracefulShutdown: true, drainGraceMs: 30_000 })
        .gracefulShutdown
    ).toEqual({ signals: ["SIGTERM"], graceMs: 30_000 });
    expect(
      resolveOptions({
        ...valid,
        gracefulShutdown: { signals: ["SIGTERM", "SIGINT"], graceMs: 5_000 },
      }).gracefulShutdown
    ).toEqual({ signals: ["SIGTERM", "SIGINT"], graceMs: 5_000 });
    expect(() =>
      resolveOptions({ ...valid, gracefulShutdown: { signals: [] } })
    ).toThrow(/must not be empty/);
    expect(() =>
      resolveOptions({ ...valid, gracefulShutdown: { graceMs: 0 } })
    ).toThrow(/positive/);
  });
});
