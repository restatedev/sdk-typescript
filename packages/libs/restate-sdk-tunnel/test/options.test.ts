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

import { describe, expect, test } from "vitest";
import {
  resolveOptions,
  buildTlsConnectOptions,
  srvNameForRegion,
} from "../src/options.js";
import { parseServerAddress } from "../src/targets.js";
import type { ConnectTunnelOptions } from "../src/types.js";

const valid: ConnectTunnelOptions = {
  region: "us",
  environmentId: "env_abc123",
  authToken: "key_xyz.secret",
  signingPublicKey: "publickeyv1_AfQwmwfgEZhrWpvv8N52SHpRtZqGGaFr4AZN6qtYWSiY",
  tunnelName: "my-tunnel",
  services: [],
};

describe("resolveOptions — validation", () => {
  test("accepts a valid config and applies defaults", () => {
    const r = resolveOptions(valid);
    expect(r.srvName).toBe("tunnel.us.restate.cloud");
    expect(r.bidirectional).toBe(true);
    expect(r.handshakeTimeoutMs).toBe(5_000);
    expect(r.reconnectInitialMs).toBe(10);
    expect(r.reconnectMaxMs).toBe(120_000);
    expect(r.reconnectFactor).toBe(2);
    expect(r.pingIntervalMs).toBe(75_000);
    expect(r.maxConcurrentStreams).toBe(4096);
    expect(r.connectionWindowSize).toBe(16 * 1024 * 1024);
    expect(r.maxSessionMemory).toBe(256);
    expect(r.tls).toBe(true);
  });

  test("rejects neither region nor tunnelServers", () => {
    expect(() => resolveOptions({ ...valid, region: undefined })).toThrow(
      /exactly one of/
    );
  });

  test("rejects both region and tunnelServers", () => {
    expect(() => resolveOptions({ ...valid, tunnelServers: ["h:1"] })).toThrow(
      /exactly one of/
    );
  });

  test("tunnelServersSrv is a third, exclusive discovery mode", () => {
    const r = resolveOptions({
      ...valid,
      region: undefined,
      tunnelServersSrv: "tunnel.dev.example.cloud",
    });
    expect(r.srvName).toBe("tunnel.dev.example.cloud");
    expect(() =>
      resolveOptions({ ...valid, tunnelServersSrv: "x.example" })
    ).toThrow(/exactly one of/);
  });

  test("a malformed tunnelServers entry throws synchronously (not a retry loop)", () => {
    // Left to the supervisor, a parse error would look like a transient
    // resolution failure and retry forever without ever connecting.
    expect(() =>
      resolveOptions({
        ...valid,
        region: undefined,
        tunnelServers: ["good.example:9080", "no-port"],
      })
    ).toThrow(/invalid tunnel server address/);
  });

  test("rejects environmentId without env_ prefix", () => {
    expect(() => resolveOptions({ ...valid, environmentId: "abc123" })).toThrow(
      /env_/
    );
  });

  test("rejects a signing key without the publickeyv1_ prefix", () => {
    expect(() =>
      resolveOptions({ ...valid, signingPublicKey: "not-a-key" })
    ).toThrow(/publickeyv1_/);
  });

  test("requires authToken, tunnelName", () => {
    expect(() => resolveOptions({ ...valid, authToken: "" })).toThrow(
      /authToken/
    );
    expect(() => resolveOptions({ ...valid, tunnelName: "" })).toThrow(
      /tunnelName/
    );
  });

  test("rejects a tunnelName with path-hostile characters", () => {
    expect(() => resolveOptions({ ...valid, tunnelName: "a/b" })).toThrow(
      /invalid tunnelName/
    );
  });

  test("deploymentId defaults to in-process and rejects path-hostile values", () => {
    expect(resolveOptions(valid).deploymentId).toBe("in-process");
    expect(
      resolveOptions({ ...valid, deploymentId: "greeterv1" }).deploymentId
    ).toBe("greeterv1");
    expect(() => resolveOptions({ ...valid, deploymentId: "a/b" })).toThrow(
      /invalid deploymentId/
    );
  });

  test("connectTimeoutMs defaults to 5s", () => {
    expect(resolveOptions(valid).connectTimeoutMs).toBe(5_000);
  });

  test("rejects header-hostile credentials (silent Node header stripping)", () => {
    expect(() =>
      resolveOptions({ ...valid, authToken: "key_x\nInjected: yes" })
    ).toThrow(/HTTP header/);
    expect(() =>
      resolveOptions({ ...valid, authToken: "key with spaces" })
    ).toThrow(/HTTP header/);
    expect(() =>
      resolveOptions({ ...valid, environmentId: "env_abc\r\n" })
    ).toThrow(/env_/);
  });

  test("rejects non-positive numeric options", () => {
    expect(() => resolveOptions({ ...valid, reconnectInitialMs: 0 })).toThrow(
      /positive/
    );
    expect(() => resolveOptions({ ...valid, pingIntervalMs: -5 })).toThrow(
      /positive/
    );
  });
});

describe("buildTlsConnectOptions — the no-ALPN invariant", () => {
  test("never sets ALPNProtocols (tunnel is not normal h2)", () => {
    // The tunnel endpoint clears its ALPN list; offering h2 would diverge
    // from the protocol, and the bridge depends on the no-ALPN shape. This
    // is the single most likely place for a relay-copy regression.
    for (const tlsOption of [
      true,
      { ca: "ca-pem" },
      { cert: "c", key: "k", rejectUnauthorized: false },
    ] as const) {
      const built = buildTlsConnectOptions(tlsOption, "host.example");
      expect(built).toBeDefined();
      expect(Object.keys(built!)).not.toContain("ALPNProtocols");
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

describe("srvNameForRegion", () => {
  test("derives the region SRV name", () => {
    expect(srvNameForRegion("us")).toBe("tunnel.us.restate.cloud");
    expect(srvNameForRegion("eu")).toBe("tunnel.eu.restate.cloud");
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
