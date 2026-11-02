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
import {
  CLOUD_KEY_PREFIX,
  parseCloudKey,
} from "../src/endpoint/connect/key.js";
import * as restate from "../src/index.js";
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
import {
  cloudKey,
  connectKey,
  encodeCloudKeyQuery,
} from "./tunnel/cloud-key.js";
import { startFakeCloud } from "./tunnel/fake-cloud.js";
import { generateIdentityKey } from "./tunnel/identity.js";

const SIGNING_KEY = "publickeyv1_w7YHemBctH5Ck2nQRQ47iBBqhNHy4FV7t2Usbye2A6f";
const ENVIRONMENT_ID = "env_201k0yd4rz8yftmd4awh1bajg4v";
const MANAGED_QUERY = `envid=${ENVIRONMENT_ID}&apikey=key_01abc.5Kd&region=eu.restate.cloud&signingkey=${SIGNING_KEY}`;
const MANAGED_KEY = encodeCloudKeyQuery(MANAGED_QUERY);
/** The key the fake cloud in the e2e tests accepts: servers come from the options. */
const fakeKey = (signingKey: string, apiKey = "key_test.secret") =>
  connectKey({
    environmentId: "env_abc123",
    apiKey,
    region: "eu.restate.cloud",
    signingKey,
  });

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
  test("decodes rstcloudv1_ + base58 into its query parameters, in order, with nothing percent-encoded", () => {
    // The UI's output for a managed environment: no `%` anywhere in the query.
    expect(MANAGED_QUERY).not.toContain("%");
    expect(MANAGED_KEY).toMatch(/^rstcloudv1_[1-9A-HJ-NP-Za-km-z]+$/);
    expect(parseCloudKey(MANAGED_KEY, "RESTATE_CONNECT_KEY", "<help>")).toEqual(
      [
        ["envid", ENVIRONMENT_ID],
        ["apikey", "key_01abc.5Kd"],
        ["region", "eu.restate.cloud"],
        ["signingkey", SIGNING_KEY],
      ]
    );
    // Surrounding whitespace (a pasted line) is fine; percent-encoded values
    // decode like any query string; repeated names are kept for the caller.
    expect(
      parseCloudKey(` ${encodeCloudKeyQuery("a=x%20y&a=2&b=")} `, "x", "<help>")
    ).toEqual([
      ["a", "x y"],
      ["a", "2"],
      ["b", ""],
    ]);
    // Leading zero bytes survive base58 (as `1`s) and are then rejected as
    // non-printable, like any other control character.
    expect(encodeCloudKeyQuery("\0\0a")).toMatch(/^rstcloudv1_11/);
    expect(() =>
      parseCloudKey(encodeCloudKeyQuery("\0\0a"), "x", "<help>")
    ).toThrow(/not a query string/);
  });

  test("rejects a wrong prefix, non-base58, non-UTF-8 or non-query content, naming the source and never echoing it", () => {
    const bad = (value: string, reason: RegExp) =>
      expect(() =>
        parseCloudKey(value, "RESTATE_CONNECT_KEY", "<help>")
      ).toThrow(
        new RegExp(
          `^RESTATE_CONNECT_KEY is not a Restate Cloud key \\(${reason.source}\\); expected rstcloudv1_<base58> — copy it again from <help>$`
        )
      );
    bad(
      "restate://key_SECRET@abc.env.eu.restate.cloud/",
      /it does not start with rstcloudv1_/
    );
    bad("rstcloudv2_abc", /it does not start with rstcloudv1_/);
    bad(CLOUD_KEY_PREFIX, /nothing follows the prefix/);
    bad(`${CLOUD_KEY_PREFIX}0OIl`, /the part after the prefix is not base58/);
    bad(
      `${CLOUD_KEY_PREFIX}abc def`,
      /the part after the prefix is not base58/
    );
    // 0xff is never valid UTF-8.
    bad(`${CLOUD_KEY_PREFIX}5Q`, /the decoded content is not UTF-8/);
    bad(
      encodeCloudKeyQuery("a=1 b=2"),
      /the decoded content is not a query string/
    );
    bad(encodeCloudKeyQuery("=1"), /the decoded content is not a query string/);
    // A secret in a malformed key never reaches the message.
    expect(() =>
      parseCloudKey("key_SECRET.abc", "RESTATE_CONNECT_KEY", "<help>")
    ).toThrow(/^(?!.*SECRET).*copy it again from <help>/);
  });

  test("becomes coordinates: signingkey → identityKeys, region → SRV, explicit options win, unknown params warned once", () => {
    const managed = resolveCoordinates({ key: MANAGED_KEY }, noWarn);
    expect(managed.environmentId).toBe(ENVIRONMENT_ID);
    expect(managed.authToken()).toBe("key_01abc.5Kd");
    expect(managed.identityKeys).toEqual([SIGNING_KEY]);
    expect(managed.discovery).toEqual({ srvName: "tunnel.eu.restate.cloud" });
    expect(managed.regionLabel).toBe("eu.restate.cloud");

    // BYOC: the region is the cluster's domain, the SRV name follows.
    const byoc = resolveCoordinates(
      {
        key: connectKey({
          environmentId: "env_abc",
          apiKey: "key_02",
          region: "inl4edhpbxasp9yuz1n0yvvkme.byoc.restate.cloud",
          signingKey: SIGNING_KEY,
        }),
      },
      noWarn
    );
    expect(byoc.environmentId).toBe("env_abc");
    expect(byoc.discovery).toEqual({
      srvName: "tunnel.inl4edhpbxasp9yuz1n0yvvkme.byoc.restate.cloud",
    });

    // Explicit options beat the key; identityKeys too.
    const explicit = resolveCoordinates(
      {
        key: MANAGED_KEY,
        servers: ["x.example:1"],
        identityKeys: ["publickeyv1_mine"],
      },
      noWarn
    );
    expect(explicit.discovery).toEqual({ servers: ["x.example:1"] });
    expect(explicit.regionLabel).toBe("x.example:1");
    expect(explicit.identityKeys).toEqual(["publickeyv1_mine"]);
    const srv = resolveCoordinates(
      { key: MANAGED_KEY, serversSrv: "tunnel.custom.example" },
      noWarn
    );
    expect(srv.discovery).toEqual({ srvName: "tunnel.custom.example" });
    expect(srv.regionLabel).toBe("custom.example");
    expect(() =>
      resolveCoordinates(
        { key: MANAGED_KEY, servers: ["x:1"], serversSrv: "s" },
        noWarn
      )
    ).toThrow(/at most one of/);

    // Missing or malformed coordinates, never echoing the key.
    const without = (name: string) =>
      encodeCloudKeyQuery(
        MANAGED_QUERY.split("&")
          .filter((p) => !p.startsWith(`${name}=`))
          .join("&")
      );
    expect(() => resolveCoordinates({ key: without("envid") }, noWarn)).toThrow(
      /no envid parameter.*integration#configure-sdk/
    );
    expect(() =>
      resolveCoordinates({ key: without("region") }, noWarn)
    ).toThrow(/no region parameter.*integration#configure-sdk/);
    expect(() =>
      resolveCoordinates(
        {
          key: cloudKey({
            envid: "abc",
            apikey: "k",
            region: "eu.restate.cloud",
            signingkey: SIGNING_KEY,
          }),
        },
        noWarn
      )
    ).toThrow(/envid is not an environment id/);
    expect(() =>
      resolveCoordinates(
        {
          key: cloudKey({
            envid: "env_abc",
            apikey: "k",
            region: "eu.restate.cloud/x",
            signingkey: SIGNING_KEY,
          }),
        },
        noWarn
      )
    ).toThrow(/region is not a domain name/);
    expect(() =>
      resolveCoordinates(
        { key: encodeCloudKeyQuery(`${MANAGED_QUERY}&apikey=again`) },
        noWarn
      )
    ).toThrow(/repeats the apikey parameter/);
    expect(() =>
      resolveCoordinates(
        {
          key: cloudKey({
            envid: "env_abc",
            apikey: "key with space",
            region: "eu.restate.cloud",
            signingkey: SIGNING_KEY,
          }),
        },
        noWarn
      )
    ).toThrow(
      /apikey contains characters that cannot travel in an HTTP header/
    );

    // A key next to an operator's variables for another environment: warned.
    process.env[ENVIRONMENT_ID_ENVS[1]] = "env_other";
    const mismatch: string[] = [];
    resolveCoordinates({ key: MANAGED_KEY }, (m) => mismatch.push(m));
    expect(mismatch).toEqual([
      `connect(): the connect key is for environment ${ENVIRONMENT_ID} but RESTATE_INPROC_ENVIRONMENT_ID is set to env_other; the key wins`,
    ]);
    delete process.env[ENVIRONMENT_ID_ENVS[1]];

    const warnings: string[] = [];
    resolveCoordinates(
      { key: encodeCloudKeyQuery(`${MANAGED_QUERY}&future=1&other=2`) },
      (m) => warnings.push(m)
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(
      /"future", "other".*envid, apikey, region, signingkey/
    );
  });

  test("without apikey the token comes from RESTATE_AUTH_TOKEN or the token file; without signingkey it is an error", () => {
    const bare = connectKey({
      environmentId: ENVIRONMENT_ID,
      region: "eu.restate.cloud",
      signingKey: SIGNING_KEY,
    });
    expect(() => resolveCoordinates({ key: bare }, noWarn)).toThrow(
      /carries no apikey.*RESTATE_AUTH_TOKEN.*RESTATE_INPROC_AUTH_TOKEN_FILE/
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

    // An ingress key (no signingkey) in RESTATE_CONNECT_KEY: said in so many words.
    expect(() =>
      resolveCoordinates(
        {
          key: connectKey({
            environmentId: ENVIRONMENT_ID,
            apiKey: "k",
            region: "eu.restate.cloud",
          }),
        },
        noWarn
      )
    ).toThrow(
      /no signingkey parameter.*an ingress key cannot connect a service.*cloud\.restate\.dev\/to\/developers\/integration#configure-sdk/
    );
    expect(() =>
      resolveCoordinates(
        {
          key: connectKey({
            environmentId: ENVIRONMENT_ID,
            apiKey: "k",
            region: "eu.restate.cloud",
            signingKey: "nope",
          }),
        },
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

    // The key, once set, wins over all of them (with a warning, since the
    // expanded variables name another environment).
    process.env[CONNECT_KEY_ENV] = MANAGED_KEY;
    const keyWins: string[] = [];
    expect(resolveCoordinates({}, (m) => keyWins.push(m)).environmentId).toBe(
      "env_201k0yd4rz8yftmd4awh1bajg4v"
    );
    expect(keyWins).toEqual([
      "connect(): the connect key is for environment env_201k0yd4rz8yftmd4awh1bajg4v but RESTATE_ENVIRONMENT_ID is set to env_canonical; the key wins",
    ]);
    expect(
      resolveCoordinates(
        {
          key: connectKey({
            environmentId: "env_x",
            apiKey: "k",
            region: "us.restate.cloud",
            signingKey: SIGNING_KEY,
          }),
        },
        () => {}
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

  test("discovery options win over the environment's region; an empty servers list stays an error", () => {
    process.env[ENVIRONMENT_ID_ENVS[0]] = "env_abc123";
    process.env[AUTH_TOKEN_ENVS[0]] = "key_xyz.secret";
    process.env[SIGNING_PUBLIC_KEY_ENVS[0]] = SIGNING_KEY;
    process.env[CLOUD_REGION_ENVS[1]] = "inl4edhpbxasp9yuz1n0yvvkme.byoc";
    const fromEnv = coordinatesFromExpanded({});
    expect(fromEnv.discovery).toEqual({
      srvName: "tunnel.inl4edhpbxasp9yuz1n0yvvkme.byoc.restate.cloud",
    });
    expect(fromEnv.regionLabel).toBe(
      "inl4edhpbxasp9yuz1n0yvvkme.byoc.restate.cloud"
    );
    expect(fromEnv.authToken()).toBe("key_xyz.secret");
    expect(fromEnv.identityKeys).toEqual([SIGNING_KEY]);
    expect(
      coordinatesFromExpanded({ serversSrv: "tunnel.dev.example" }).discovery
    ).toEqual({ srvName: "tunnel.dev.example" });
    expect(() => coordinatesFromExpanded({ servers: [] })).toThrow(
      /must not be empty/
    );
    expect(() =>
      coordinatesFromExpanded({ servers: ["h:1"], serversSrv: "s" })
    ).toThrow(/at most one of/);
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
    process.env[CONNECT_KEY_ENV] = fakeKey(identity.publicKey);
    process.env[CONNECT_NAME_ENVS[0]] = "greeter-v1";
    const connection = restate.connect({
      services: [],
      logger,
      connection: { servers: [`http://127.0.0.1:${fake.port}`] },
    });
    try {
      await connection.ready;
      expect(connection.name).toBe("greeter-v1");
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

  test("an operator pod: RESTATE_INPROC_* variables and a token file, no key, end to end", async () => {
    const identity = generateIdentityKey();
    const fake = await startFakeCloud({
      decideTrailers: () => ({
        "tunnel-status": "ok",
        "proxy-url":
          "https://tunnel.eu.restate.cloud:9080/abc123/greeter-7f9c4",
        "tunnel-url": "https://tunnel.eu.restate.cloud:9080",
        "tunnel-name": "greeter-7f9c4",
      }),
    });
    process.env[ENVIRONMENT_ID_ENVS[1]] = "env_abc123";
    process.env[CONNECT_NAME_ENVS[1]] = "greeter-7f9c4";
    process.env[SIGNING_PUBLIC_KEY_ENVS[1]] = identity.publicKey;
    process.env[AUTH_TOKEN_FILE_ENVS[0]] = tokenFile("key_mounted.secret\n");
    // The operator injects a region; the test points discovery at the fake.
    process.env[CLOUD_REGION_ENVS[1]] = "eu";
    const lines: string[] = [];
    const connection = restate.connect({
      services: [],
      logger: (_params, message) => {
        lines.push(String(message));
      },
      connection: { servers: [`http://127.0.0.1:${fake.port}`] },
    });
    try {
      await connection.ready;
      expect(connection.name).toBe("greeter-7f9c4");
      const creds = await (await fake.waitForConnection(0)).creds;
      expect(creds["authorization"]).toBe("Bearer key_mounted.secret");
      expect(creds["environment-id"]).toBe("env_abc123");
      expect(creds["tunnel-name"]).toBe("greeter-7f9c4");
      expect(lines).toContain(
        "  restate deployments register connect://greeter-7f9c4"
      );
    } finally {
      await connection.close();
      await fake.close();
    }
  });

  test("a fatal stop rejects ready and, afterwards, close()", async () => {
    const identity = generateIdentityKey();
    const fake = await startFakeCloud({
      decideTrailers: () => ({ "tunnel-status": "unauthorized" }),
    });
    process.env[CONNECT_KEY_ENV] = fakeKey(identity.publicKey, "key_bad");
    const errors: string[] = [];
    const connection = restate.connect({
      services: [],
      name: "greeter-v1",
      logger: (params, message) => {
        if (params.level === "error") errors.push(String(message));
      },
      connection: { servers: [`http://127.0.0.1:${fake.port}`] },
    });
    try {
      await expect(connection.ready).rejects.toThrow(/unauthorized/);
      await expect(connection.close()).rejects.toThrow(/unauthorized/);
      // Explained in plain words, once, with the fix; the raw engine line is debug.
      expect(errors).toEqual([
        "Restate Cloud rejected the connect key for environment env_abc123: it is invalid, revoked, or for another environment.",
        "Create a new key at https://cloud.restate.dev/to/developers/integration#configure-sdk and set RESTATE_CONNECT_KEY.",
        "Not retrying. Fix the configuration and restart.",
      ]);
    } finally {
      await fake.close();
    }
  });

  test("reconnectRetryPolicy.maxAttempts: giving up is a fatal stop, explained", async () => {
    const identity = generateIdentityKey();
    // A stalled handshake is retryable; with two attempts allowed the engine gives up.
    const fake = await startFakeCloud({ decideTrailers: () => null });
    process.env[CONNECT_KEY_ENV] = fakeKey(identity.publicKey, "key_test");
    const errors: string[] = [];
    const connection = restate.connect({
      services: [],
      name: "greeter-v1",
      logger: (params, message) => {
        if (params.level === "error") errors.push(String(message));
      },
      connection: {
        servers: [`http://127.0.0.1:${fake.port}`],
        handshakeTimeoutMs: 50,
        reconnectRetryPolicy: { maxAttempts: 2, initialInterval: 1 },
      },
    });
    try {
      await expect(connection.ready).rejects.toThrow(
        /gave up reconnecting after 2 attempt/
      );
      expect(errors[0]).toMatch(
        /^Could not reach Restate Cloud for environment env_abc123: gave up/
      );
      expect(errors[1]).toMatch(/RESTATE_CONNECT_KEY/);
    } finally {
      await connection.close().catch(() => {});
      await fake.close();
    }
  });

  test("misconfiguration throws synchronously; the legacy API is not exported", () => {
    expect(() => restate.connect({ services: [] })).toThrow(/needs a name/);
    expect(() => restate.connect({ services: [], name: "x" })).toThrow(
      /RESTATE_CONNECT_KEY/
    );
    expect("connectTunnel" in restate).toBe(false);
    expect("_connectTunnel" in restate).toBe(false);
  });
});
