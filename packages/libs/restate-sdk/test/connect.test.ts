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

// connect(): how the name and the key resolve, what the errors say, and the
// banner. The engine itself is covered in test/tunnel.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { parseCloudKey } from "@restatedev/restate-sdk-core";
import * as restate from "../src/index.js";
import { connectTunnel } from "../src/endpoint/connect/tunnel.js";
import {
  AUTH_TOKEN_ENVS,
  AUTH_TOKEN_FILE_ENVS,
  CLOUD_REGION_ENVS,
  CONNECT_KEY_ENV,
  CONNECT_NAME_ENVS,
  ENVIRONMENT_ID_ENVS,
  SIGNING_PUBLIC_KEY_ENVS,
  TUNNEL_SERVERS_ENVS,
  TUNNEL_SERVERS_SRV_ENVS,
  coordinatesFromExpanded,
  resolveCoordinates,
  resolveName,
} from "../src/endpoint/connect/env.js";
import { buildDeploymentUrl } from "../src/endpoint/tunnel/engine.js";
import {
  LogSource,
  type LoggerTransport,
} from "../src/logging/logger_transport.js";
import { startFakeCloud } from "./tunnel/fake-cloud.js";
import { generateIdentityKey } from "./tunnel/identity.js";

const SIGNING_KEY = "publickeyv1_w7YHemBctH5Ck2nQRQ47iBBqhNHy4FV7t2Usbye2A6f";
const HOST = "201k0yd4rz8yftmd4awh1bajg4v.env.eu.restate.cloud";
const MANAGED_KEY = `restate://key_01abc.5Kd@${HOST}/?signing-key=${SIGNING_KEY}`;

const ENVS = [
  CONNECT_KEY_ENV,
  ...CONNECT_NAME_ENVS,
  ...ENVIRONMENT_ID_ENVS,
  ...AUTH_TOKEN_ENVS,
  ...AUTH_TOKEN_FILE_ENVS,
  ...CLOUD_REGION_ENVS,
  ...TUNNEL_SERVERS_SRV_ENVS,
  ...TUNNEL_SERVERS_ENVS,
  ...SIGNING_PUBLIC_KEY_ENVS,
];
const saved: Record<string, string | undefined> = {};
const tmpDirs: string[] = [];
beforeEach(() => {
  for (const name of ENVS) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
});
afterEach(() => {
  for (const name of ENVS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const tokenFile = (contents: string): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "connect-token-"));
  tmpDirs.push(dir);
  const file = path.join(dir, "token");
  fs.writeFileSync(file, contents);
  return file;
};

const noWarn = (message: string) => {
  throw new Error(`unexpected warning: ${message}`);
};

describe("the connect key", () => {
  test("parses the managed and BYOC shapes: API key, environment id, region domain, parameters", () => {
    const managed = parseCloudKey(MANAGED_KEY, "RESTATE_CONNECT_KEY");
    expect(managed).toEqual({
      apiKey: "key_01abc.5Kd",
      host: HOST,
      environmentId: "env_201k0yd4rz8yftmd4awh1bajg4v",
      regionDomain: "eu.restate.cloud",
      params: [["signing-key", SIGNING_KEY]],
    });
    const byoc = parseCloudKey(
      "restate://key_02@abc.env.inl4edhpbxasp9yuz1n0yvvkme.byoc.restate.cloud",
      "x"
    );
    expect(byoc.environmentId).toBe("env_abc");
    expect(byoc.regionDomain).toBe(
      "inl4edhpbxasp9yuz1n0yvvkme.byoc.restate.cloud"
    );
    expect(byoc.apiKey).toBe("key_02");
    expect(byoc.params).toEqual([]);
    // No userinfo is allowed by the grammar (the token may come from a file).
    expect(parseCloudKey(`restate://${HOST}/`, "x").apiKey).toBeUndefined();
    // A percent-encoded key is decoded; a `:` splits into user:password and is re-joined.
    expect(parseCloudKey(`restate://key%40x:y@${HOST}/`, "x").apiKey).toBe(
      "key@x:y"
    );
  });

  test("rejects a bad scheme, path, port, fragment or host, naming the source", () => {
    const bad = (value: string, reason: RegExp) =>
      expect(() => parseCloudKey(value, "RESTATE_CONNECT_KEY")).toThrow(
        new RegExp(
          `^RESTATE_CONNECT_KEY is not a Restate Cloud key \\(${reason.source}`
        )
      );
    bad(`https://k@${HOST}/`, /the scheme is "https", not restate/);
    bad(`restate://k@${HOST}/path`, /the path must be empty, got "\/path"/);
    bad(`restate://k@${HOST}:8080/`, /the host must not carry a port/);
    bad(`restate://k@${HOST}/#x`, /a fragment is not allowed/);
    bad(
      "restate://k@abc.eu.restate.cloud/",
      /the host must be <environment id>\.env\.<region domain>/
    );
    bad("restate://k@.env.eu.restate.cloud/", /the host must be/);
    bad("restate://k@abc.env./", /the host must be/);
    bad("not a url", /not a URL/);
  });

  test("becomes coordinates: signing key → identityKeys, region domain → SRV, tunnel-srv / tunnel-servers override, unknown params warned once", () => {
    const managed = resolveCoordinates({ key: MANAGED_KEY }, noWarn);
    expect(managed.environmentId).toBe("env_201k0yd4rz8yftmd4awh1bajg4v");
    expect(managed.authToken()).toBe("key_01abc.5Kd");
    expect(managed.identityKeys).toEqual([SIGNING_KEY]);
    expect(managed.discovery).toEqual({ srvName: "tunnel.eu.restate.cloud" });
    expect(managed.regionLabel).toBe("eu.restate.cloud");

    const srv = resolveCoordinates(
      { key: `${MANAGED_KEY}&tunnel-srv=tunnel.custom.example` },
      noWarn
    );
    expect(srv.discovery).toEqual({ srvName: "tunnel.custom.example" });
    expect(srv.regionLabel).toBe("custom.example");

    const servers = resolveCoordinates(
      { key: `${MANAGED_KEY}&tunnel-servers=a.example:9080,%20b.example:9080` },
      noWarn
    );
    expect(servers.discovery).toEqual({
      servers: ["a.example:9080", "b.example:9080"],
    });
    expect(servers.regionLabel).toBe("a.example:9080,b.example:9080");

    // Explicit options beat the key; identityKeys too.
    const explicit = resolveCoordinates(
      {
        key: `${MANAGED_KEY}&tunnel-srv=tunnel.custom.example`,
        servers: ["x.example:1"],
        identityKeys: ["publickeyv1_mine"],
      },
      noWarn
    );
    expect(explicit.discovery).toEqual({ servers: ["x.example:1"] });
    expect(explicit.identityKeys).toEqual(["publickeyv1_mine"]);
    expect(() =>
      resolveCoordinates(
        { key: MANAGED_KEY, servers: ["x:1"], serversSrv: "s" },
        noWarn
      )
    ).toThrow(/at most one of/);

    const warnings: string[] = [];
    resolveCoordinates({ key: `${MANAGED_KEY}&future=1&other=2` }, (m) =>
      warnings.push(m)
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/"future", "other"/);
  });

  test("without userinfo the token comes from RESTATE_AUTH_TOKEN or the token file; without signing-key it is an error", () => {
    const bare = `restate://${HOST}/?signing-key=${SIGNING_KEY}`;
    expect(() => resolveCoordinates({ key: bare }, noWarn)).toThrow(
      /carries no API key.*RESTATE_AUTH_TOKEN.*RESTATE_INPROC_AUTH_TOKEN_FILE/
    );
    const file = tokenFile("key_fromfile\n");
    process.env[AUTH_TOKEN_FILE_ENVS[0]] = file;
    const fromFile = resolveCoordinates({ key: bare }, noWarn);
    expect(fromFile.authToken()).toBe("key_fromfile");
    fs.writeFileSync(file, "key_rotated\n");
    expect(fromFile.authToken()).toBe("key_rotated"); // re-read on every call
    process.env[AUTH_TOKEN_ENVS[0]] = "key_fromenv";
    expect(resolveCoordinates({ key: bare }, noWarn).authToken()).toBe(
      "key_fromenv"
    );
    // The key's own API key wins over both.
    expect(resolveCoordinates({ key: MANAGED_KEY }, noWarn).authToken()).toBe(
      "key_01abc.5Kd"
    );

    expect(() =>
      resolveCoordinates({ key: `restate://k@${HOST}/` }, noWarn)
    ).toThrow(
      /no signing-key parameter.*cloud\.restate\.dev\/to\/developers\/integration#configure-sdk/
    );
    expect(() =>
      resolveCoordinates(
        { key: `restate://k@${HOST}/?signing-key=nope` },
        noWarn
      )
    ).toThrow(/publickeyv1_/);
  });
});

describe("resolution from the environment", () => {
  test("name: option → RESTATE_CONNECT_NAME → RESTATE_INPROC_TUNNEL_NAME → RESTATE_TUNNEL_NAME → error; validated", () => {
    expect(() => resolveName(undefined)).toThrow(
      /needs a name.*RESTATE_CONNECT_NAME.*connect:\/\/<name>/
    );
    process.env[CONNECT_NAME_ENVS[2]] = "from-tunnel-name";
    expect(resolveName(undefined)).toBe("from-tunnel-name");
    process.env[CONNECT_NAME_ENVS[1]] = "from-inproc";
    expect(resolveName(undefined)).toBe("from-inproc");
    process.env[CONNECT_NAME_ENVS[0]] = "from-connect-name";
    expect(resolveName(undefined)).toBe("from-connect-name");
    expect(resolveName("")).toBe("from-connect-name");
    expect(resolveName("explicit.v1_a-b")).toBe("explicit.v1_a-b");
    expect(() => resolveName("a/b")).toThrow(/invalid deployment name/);
  });

  test("key: option → RESTATE_CONNECT_KEY → expanded variables → error naming the variable and the UI page", () => {
    expect(() => resolveCoordinates({}, noWarn)).toThrow(
      /set RESTATE_CONNECT_KEY \(create one at https:\/\/cloud\.restate\.dev\/to\/developers\/integration#configure-sdk\)/
    );

    // Expanded RESTATE_* variables, RESTATE_INPROC_* second in each chain.
    process.env[ENVIRONMENT_ID_ENVS[1]] = "env_inproc";
    process.env[CLOUD_REGION_ENVS[1]] = "us";
    process.env[SIGNING_PUBLIC_KEY_ENVS[1]] = "publickeyv1_inproc";
    process.env[AUTH_TOKEN_FILE_ENVS[0]] = tokenFile("key_fromfile");
    const inproc = resolveCoordinates({}, noWarn);
    expect(inproc.environmentId).toBe("env_inproc");
    expect(inproc.discovery).toEqual({ srvName: "tunnel.us.restate.cloud" });
    expect(inproc.regionLabel).toBe("us.restate.cloud");
    expect(inproc.identityKeys).toEqual(["publickeyv1_inproc"]);
    expect(inproc.authToken()).toBe("key_fromfile");

    process.env[ENVIRONMENT_ID_ENVS[0]] = "env_canonical";
    process.env[CLOUD_REGION_ENVS[0]] = "eu";
    process.env[SIGNING_PUBLIC_KEY_ENVS[0]] = "publickeyv1_canonical";
    process.env[AUTH_TOKEN_ENVS[0]] = "key_canonical";
    const canonical = resolveCoordinates({}, noWarn);
    expect(canonical.environmentId).toBe("env_canonical");
    expect(canonical.discovery).toEqual({ srvName: "tunnel.eu.restate.cloud" });
    expect(canonical.identityKeys).toEqual(["publickeyv1_canonical"]);
    expect(canonical.authToken()).toBe("key_canonical");

    // Discovery chain without a region: SRV, then servers, then the inproc region.
    delete process.env[CLOUD_REGION_ENVS[0]];
    process.env[TUNNEL_SERVERS_SRV_ENVS[0]] = "tunnel.byoc.example";
    process.env[TUNNEL_SERVERS_ENVS[0]] = "a.example:9080, b.example:9080";
    expect(resolveCoordinates({}, noWarn).discovery).toEqual({
      srvName: "tunnel.byoc.example",
    });
    delete process.env[TUNNEL_SERVERS_SRV_ENVS[0]];
    expect(resolveCoordinates({}, noWarn).discovery).toEqual({
      servers: ["a.example:9080", "b.example:9080"],
    });
    delete process.env[TUNNEL_SERVERS_ENVS[0]];
    expect(resolveCoordinates({}, noWarn).discovery).toEqual({
      srvName: "tunnel.us.restate.cloud",
    });

    // The key, once set, wins over all of them.
    process.env[CONNECT_KEY_ENV] = MANAGED_KEY;
    expect(resolveCoordinates({}, noWarn).environmentId).toBe(
      "env_201k0yd4rz8yftmd4awh1bajg4v"
    );
    expect(
      resolveCoordinates(
        {
          key: `restate://k@x.env.us.restate.cloud/?signing-key=${SIGNING_KEY}`,
        },
        noWarn
      ).environmentId
    ).toBe("env_x");
    // A malformed RESTATE_CONNECT_KEY names the variable.
    process.env[CONNECT_KEY_ENV] = "restate://k@nohost/";
    expect(() => resolveCoordinates({}, noWarn)).toThrow(
      /^RESTATE_CONNECT_KEY is not a Restate Cloud key/
    );
  });

  test("expanded variables: each missing piece names its variable and the key; values are validated", () => {
    process.env[ENVIRONMENT_ID_ENVS[0]] = "env_abc";
    expect(() => resolveCoordinates({}, noWarn)).toThrow(
      /authToken is required.*RESTATE_AUTH_TOKEN.*RESTATE_INPROC_AUTH_TOKEN_FILE.*RESTATE_CONNECT_KEY/
    );
    process.env[AUTH_TOKEN_ENVS[0]] = "key_abc";
    expect(() => resolveCoordinates({}, noWarn)).toThrow(
      /signingPublicKey is required.*RESTATE_SIGNING_PUBLIC_KEY/
    );
    process.env[SIGNING_PUBLIC_KEY_ENVS[0]] = SIGNING_KEY;
    expect(() => resolveCoordinates({}, noWarn)).toThrow(
      /no Restate Cloud region.*RESTATE_CLOUD_REGION/
    );
    process.env[CLOUD_REGION_ENVS[0]] = "US";
    expect(() => resolveCoordinates({}, noWarn)).toThrow(/invalid region/);
    process.env[CLOUD_REGION_ENVS[0]] = "eu";
    process.env[ENVIRONMENT_ID_ENVS[0]] = "abc";
    expect(() => resolveCoordinates({}, noWarn)).toThrow(/env_/);
    process.env[ENVIRONMENT_ID_ENVS[0]] = "env_abc";
    process.env[AUTH_TOKEN_ENVS[0]] = "key with spaces";
    expect(() => resolveCoordinates({}, noWarn)).toThrow(/HTTP header/);

    // Token-file misconfiguration throws at resolve time, not mid-redial.
    delete process.env[AUTH_TOKEN_ENVS[0]];
    process.env[AUTH_TOKEN_FILE_ENVS[0]] = "/does/not/exist/token";
    expect(() => resolveCoordinates({}, noWarn)).toThrow();
    process.env[AUTH_TOKEN_FILE_ENVS[0]] = tokenFile("\n");
    expect(() => resolveCoordinates({}, noWarn)).toThrow(/empty/);
    process.env[AUTH_TOKEN_FILE_ENVS[0]] = path.dirname(tokenFile("x"));
    expect(() => resolveCoordinates({}, noWarn)).toThrow(/not a regular file/);
  });

  test("connectTunnel()'s explicit fields map onto the expanded resolution, exactly one discovery option", () => {
    const explicit = coordinatesFromExpanded({
      region: "inl4edhpbxasp9yuz1n0yvvkme.byoc",
      environmentId: "env_abc123",
      authToken: "key_xyz.secret",
      signingPublicKey: SIGNING_KEY,
    });
    expect(explicit.discovery).toEqual({
      srvName: "tunnel.inl4edhpbxasp9yuz1n0yvvkme.byoc.restate.cloud",
    });
    expect(explicit.regionLabel).toBe(
      "inl4edhpbxasp9yuz1n0yvvkme.byoc.restate.cloud"
    );
    expect(explicit.authToken()).toBe("key_xyz.secret");
    expect(explicit.identityKeys).toEqual([SIGNING_KEY]);

    process.env[CLOUD_REGION_ENVS[1]] = "eu";
    const base = {
      environmentId: "env_abc123",
      authToken: "key_xyz.secret",
      signingPublicKey: SIGNING_KEY,
    };
    // An explicit discovery option beats an injected region …
    expect(
      coordinatesFromExpanded({
        ...base,
        serversSrv: "tunnel.dev.example",
      }).discovery
    ).toEqual({ srvName: "tunnel.dev.example" });
    // … an explicitly empty servers stays a loud error …
    expect(() => coordinatesFromExpanded({ ...base, servers: [] })).toThrow(
      /specify one of/
    );
    // … and two discovery options are rejected.
    expect(() =>
      coordinatesFromExpanded({ ...base, region: "us", servers: ["h:1"] })
    ).toThrow(/exactly one of/);
  });
});

describe("the deployment URL", () => {
  test("pins port 9080 whatever the proxy-url trailer carries and appends the in-process tail", () => {
    expect(
      buildDeploymentUrl("https://tunnel.example:9082/abc123/greeter-v1")
    ).toBe(
      "https://tunnel.example:9080/abc123/greeter-v1/http/in-process/9080/"
    );
    expect(
      buildDeploymentUrl("https://tunnel.example/abc123/greeter-v1/")
    ).toBe(
      "https://tunnel.example:9080/abc123/greeter-v1/http/in-process/9080/"
    );
    expect(buildDeploymentUrl("not a url")).toBe(
      "not a url/http/in-process/9080/"
    );
  });
});

describe("connect() end to end", () => {
  test("logs the banner on ready through the SDK logger, exactly the contract lines", async () => {
    const identity = generateIdentityKey();
    const fake = await startFakeCloud({
      decideTrailers: () => ({
        "tunnel-status": "ok",
        "proxy-url": "https://tunnel.eu.restate.cloud:9082/abc123/greeter-v1",
        "tunnel-url": "https://tunnel.eu.restate.cloud:9080",
        "tunnel-name": "greeter-v1",
      }),
    });
    const lines: Array<{ level: string; source: string; message: string }> = [];
    const logger: LoggerTransport = (params, message) => {
      lines.push({
        level: params.level,
        source: params.source,
        message: String(message),
      });
    };
    process.env[CONNECT_KEY_ENV] =
      `restate://key_test.secret@abc123.env.eu.restate.cloud/?signing-key=${identity.publicKey}&tunnel-servers=http://127.0.0.1:${fake.port}`;
    process.env[CONNECT_NAME_ENVS[0]] = "greeter-v1";
    const connection = restate.connect({ services: [], logger });
    try {
      await connection.ready;
      expect(connection.name).toBe("greeter-v1");
      expect(connection.deploymentUrl).toBe(
        "https://tunnel.eu.restate.cloud:9080/abc123/greeter-v1/http/in-process/9080/"
      );
      const info = lines.filter(
        (l) =>
          l.level === "info" &&
          l.source === LogSource.SYSTEM &&
          !l.message.startsWith("tunnel:") &&
          !l.message.startsWith("Validating requests")
      );
      expect(info.map((l) => l.message)).toEqual([
        "Connecting to Restate Cloud environment env_abc123 (http://127.0.0.1:" +
          fake.port +
          ")",
        'Connected as "greeter-v1"',
        "Register it once:",
        "  restate deployments register connect://greeter-v1",
        "  or open https://cloud.restate.dev/to/overview?register-deployment=connect://greeter-v1",
      ]);
    } finally {
      await connection.close();
      await fake.close();
    }
  });

  test("misconfiguration throws synchronously; connectTunnel() is the same engine and warns once", async () => {
    expect(() => restate.connect({ services: [] })).toThrow(/needs a name/);
    expect(() => restate.connect({ services: [], name: "x" })).toThrow(
      /RESTATE_CONNECT_KEY/
    );

    const identity = generateIdentityKey();
    const fake = await startFakeCloud({
      decideTrailers: () => ({
        "tunnel-status": "ok",
        "proxy-url": "https://tunnel.example:9080/abc123/legacy",
        "tunnel-url": "https://tunnel.example:9080",
        "tunnel-name": "legacy",
      }),
    });
    const warnings: string[] = [];
    const logger: LoggerTransport = (params, message) => {
      if (params.level === "warn") warnings.push(String(message));
    };
    const legacy = connectTunnel({
      services: [],
      logger,
      tunnelServers: [`http://127.0.0.1:${fake.port}`],
      environmentId: "env_abc123",
      authToken: "key_test.secret",
      signingPublicKey: identity.publicKey,
      tunnelName: "legacy",
    });
    try {
      await legacy.ready;
      expect(legacy.tunnelName).toBe("legacy");
      expect(legacy.proxyUrl).toBe("https://tunnel.example:9080/abc123/legacy");
      // The regular SDK does not expose the legacy API.
      expect("connectTunnel" in restate).toBe(false);
      const creds = await (await fake.waitForConnection(0)).creds;
      expect(creds["authorization"]).toBe("Bearer key_test.secret");
      expect(creds["environment-id"]).toBe("env_abc123");
      expect(warnings.filter((w) => w.includes("deprecated"))).toHaveLength(1);
    } finally {
      await legacy.close();
      await fake.close();
    }
  });
});
