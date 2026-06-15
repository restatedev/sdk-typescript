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

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  resolveOptions,
  buildTlsConnectOptions,
  srvNameForRegion,
  TUNNEL_NAME_ENV,
  ENVIRONMENT_ID_ENV,
  CLOUD_REGION_ENV,
  SIGNING_PUBLIC_KEY_ENV,
  AUTH_TOKEN_FILE_ENV,
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

const INPROC_ENVS = [
  TUNNEL_NAME_ENV,
  ENVIRONMENT_ID_ENV,
  CLOUD_REGION_ENV,
  SIGNING_PUBLIC_KEY_ENV,
  AUTH_TOKEN_FILE_ENV,
];

// Options resolution reads RESTATE_INPROC_* fallbacks from process.env;
// isolate every test from the host environment and from each other.
const savedEnv: Record<string, string | undefined> = {};
const tmpDirs: string[] = [];
beforeEach(() => {
  for (const name of INPROC_ENVS) {
    savedEnv[name] = process.env[name];
    delete process.env[name];
  }
});
afterEach(() => {
  for (const name of INPROC_ENVS) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

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

  test("accepts a multi-label (BYOC) region", () => {
    const r = resolveOptions({
      ...valid,
      region: "inl4edhpbxasp9yuz1n0yvvkme.byoc",
    });
    expect(r.srvName).toBe(
      "tunnel.inl4edhpbxasp9yuz1n0yvvkme.byoc.restate.cloud"
    );
  });

  test("rejects a malformed region", () => {
    for (const region of ["US", "us/extra", ".us", "us.", "us..eu"]) {
      expect(() => resolveOptions({ ...valid, region })).toThrow(
        /invalid region/
      );
    }
  });

  test("rejects neither region nor tunnelServers", () => {
    expect(() => resolveOptions({ ...valid, region: undefined })).toThrow(
      new RegExp(`specify one of .*${CLOUD_REGION_ENV}`)
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

describe("resolveOptions — RESTATE_INPROC_* environment fallbacks", () => {
  const tokenFile = (contents: string): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tunnel-token-"));
    tmpDirs.push(dir);
    const file = path.join(dir, "token");
    fs.writeFileSync(file, contents);
    return file;
  };

  test("a fully operator-configured pod needs only the token file", () => {
    process.env[TUNNEL_NAME_ENV] = "greeter-5b8c7d9f4";
    process.env[ENVIRONMENT_ID_ENV] = "env_abc123";
    process.env[CLOUD_REGION_ENV] = "eu";
    process.env[SIGNING_PUBLIC_KEY_ENV] = valid.signingPublicKey!;
    process.env[AUTH_TOKEN_FILE_ENV] = tokenFile("key_fromfile.secret\n");

    const r = resolveOptions({ services: [] });
    expect(r.tunnelName).toBe("greeter-5b8c7d9f4");
    expect(r.environmentId).toBe("env_abc123");
    expect(r.srvName).toBe("tunnel.eu.restate.cloud");
    expect(r.signingPublicKey).toBe(valid.signingPublicKey);
    // mounted secrets routinely carry a trailing newline — trimmed
    expect(r.authToken()).toBe("key_fromfile.secret");
  });

  test("explicit options win over the environment", () => {
    process.env[TUNNEL_NAME_ENV] = "from-env";
    process.env[ENVIRONMENT_ID_ENV] = "env_fromenv";
    process.env[CLOUD_REGION_ENV] = "eu";
    process.env[SIGNING_PUBLIC_KEY_ENV] = "publickeyv1_fromenv";
    process.env[AUTH_TOKEN_FILE_ENV] = tokenFile("key_fromfile");

    const r = resolveOptions(valid);
    expect(r.tunnelName).toBe("my-tunnel");
    expect(r.environmentId).toBe("env_abc123");
    expect(r.srvName).toBe("tunnel.us.restate.cloud");
    expect(r.signingPublicKey).toBe(valid.signingPublicKey);
    expect(r.authToken()).toBe("key_xyz.secret");
  });

  test("an explicit discovery option beats an injected region", () => {
    process.env[CLOUD_REGION_ENV] = "eu";
    // would be a "specify exactly one" conflict if the env region counted
    const r = resolveOptions({
      ...valid,
      region: undefined,
      tunnelServersSrv: "tunnel.dev.example.cloud",
    });
    expect(r.srvName).toBe("tunnel.dev.example.cloud");
  });

  test("an explicitly empty tunnelServers stays a config error despite an env region", () => {
    process.env[CLOUD_REGION_ENV] = "eu";
    expect(() =>
      resolveOptions({ ...valid, region: undefined, tunnelServers: [] })
    ).toThrow(/specify one of/);
  });

  test("environment-sourced values get the same validation as options", () => {
    process.env[ENVIRONMENT_ID_ENV] = "not-an-env-id";
    expect(() =>
      resolveOptions({ ...valid, environmentId: undefined })
    ).toThrow(/env_/);
  });

  test("an empty env var counts as unset", () => {
    process.env[TUNNEL_NAME_ENV] = "";
    expect(() => resolveOptions({ ...valid, tunnelName: undefined })).toThrow(
      new RegExp(`tunnelName is required .*${TUNNEL_NAME_ENV}`)
    );
  });

  test("missing-value errors name the env var that would fill the gap", () => {
    expect(() =>
      resolveOptions({ ...valid, environmentId: undefined })
    ).toThrow(new RegExp(ENVIRONMENT_ID_ENV));
    expect(() => resolveOptions({ ...valid, authToken: undefined })).toThrow(
      new RegExp(AUTH_TOKEN_FILE_ENV)
    );
    expect(() =>
      resolveOptions({ ...valid, signingPublicKey: undefined })
    ).toThrow(new RegExp(SIGNING_PUBLIC_KEY_ENV));
  });

  test("a token file is re-read on every call — rotation without restart", () => {
    const file = tokenFile("key_first");
    process.env[AUTH_TOKEN_FILE_ENV] = file;

    const r = resolveOptions({ ...valid, authToken: undefined });
    expect(r.authToken()).toBe("key_first");
    fs.writeFileSync(file, "key_second\n");
    expect(r.authToken()).toBe("key_second");
  });

  test("token-file misconfiguration throws at resolve time, not mid-redial", () => {
    process.env[AUTH_TOKEN_FILE_ENV] = "/does/not/exist/token";
    expect(() => resolveOptions({ ...valid, authToken: undefined })).toThrow();

    process.env[AUTH_TOKEN_FILE_ENV] = tokenFile("\n");
    expect(() => resolveOptions({ ...valid, authToken: undefined })).toThrow(
      /empty/
    );

    process.env[AUTH_TOKEN_FILE_ENV] = tokenFile("key with spaces");
    expect(() => resolveOptions({ ...valid, authToken: undefined })).toThrow(
      /HTTP header/
    );

    // a non-regular file (here: a directory) is rejected by the stat guard
    // BEFORE the read — a FIFO would block the event loop forever
    process.env[AUTH_TOKEN_FILE_ENV] = path.dirname(tokenFile("x"));
    expect(() => resolveOptions({ ...valid, authToken: undefined })).toThrow(
      /not a regular file/
    );
  });

  test("a token read failure after resolve surfaces from the provider", () => {
    const file = tokenFile("key_first");
    process.env[AUTH_TOKEN_FILE_ENV] = file;
    const r = resolveOptions({ ...valid, authToken: undefined });
    fs.rmSync(file);
    expect(() => r.authToken()).toThrow();
  });

  test("an explicit authToken never touches the file system", () => {
    process.env[AUTH_TOKEN_FILE_ENV] = "/does/not/exist/token";
    const r = resolveOptions(valid);
    expect(r.authToken()).toBe("key_xyz.secret");
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

describe("client-drain / graceful-shutdown options", () => {
  test("supportsClientDrain defaults to true", () => {
    expect(resolveOptions(valid).supportsClientDrain).toBe(true);
  });

  test("supportsClientDrain can be disabled", () => {
    expect(
      resolveOptions({ ...valid, supportsClientDrain: false })
        .supportsClientDrain
    ).toBe(false);
  });

  test("gracefulShutdown is undefined unless opted in", () => {
    expect(resolveOptions(valid).gracefulShutdown).toBeUndefined();
    expect(
      resolveOptions({ ...valid, gracefulShutdown: false }).gracefulShutdown
    ).toBeUndefined();
  });

  test("gracefulShutdown: true uses SIGTERM and the drain grace", () => {
    expect(
      resolveOptions({ ...valid, gracefulShutdown: true }).gracefulShutdown
    ).toEqual({ signals: ["SIGTERM"], graceMs: 120_000 });
  });

  test("gracefulShutdown: true inherits a custom drainGraceMs", () => {
    expect(
      resolveOptions({ ...valid, gracefulShutdown: true, drainGraceMs: 30_000 })
        .gracefulShutdown
    ).toEqual({ signals: ["SIGTERM"], graceMs: 30_000 });
  });

  test("gracefulShutdown accepts custom signals and grace", () => {
    expect(
      resolveOptions({
        ...valid,
        gracefulShutdown: { signals: ["SIGTERM", "SIGINT"], graceMs: 5_000 },
      }).gracefulShutdown
    ).toEqual({ signals: ["SIGTERM", "SIGINT"], graceMs: 5_000 });
  });

  test("gracefulShutdown rejects an empty signal list", () => {
    expect(() =>
      resolveOptions({ ...valid, gracefulShutdown: { signals: [] } })
    ).toThrow(/must not be empty/);
  });

  test("gracefulShutdown rejects a non-positive grace", () => {
    expect(() =>
      resolveOptions({ ...valid, gracefulShutdown: { graceMs: 0 } })
    ).toThrow(/positive/);
  });
});
