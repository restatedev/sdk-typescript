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
  AUTH_TOKEN_ENVS,
  AUTH_TOKEN_FILE_ENVS,
  buildDeploymentUrl,
  CLOUD_REGION_ENVS,
  decideServeMode,
  ENVIRONMENT_ID_ENVS,
  INGRESS_URL_ENVS,
  readDiscoveryEnv,
  registrationDeepLink,
  registrationIdentifier,
  SIGNING_PUBLIC_KEY_ENVS,
  TUNNEL_NAME_ENVS,
  TUNNEL_SERVERS_ENVS,
  TUNNEL_SERVERS_SRV_ENVS,
} from "../src/endpoint/cloud_env.js";

const ALL_ENVS = [
  ...ENVIRONMENT_ID_ENVS,
  ...AUTH_TOKEN_ENVS,
  ...AUTH_TOKEN_FILE_ENVS,
  ...CLOUD_REGION_ENVS,
  ...TUNNEL_SERVERS_SRV_ENVS,
  ...TUNNEL_SERVERS_ENVS,
  ...SIGNING_PUBLIC_KEY_ENVS,
  ...TUNNEL_NAME_ENVS,
  ...INGRESS_URL_ENVS,
];
const saved: Record<string, string | undefined> = {};
const tmpDirs: string[] = [];
beforeEach(() => {
  for (const name of ALL_ENVS) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
});
afterEach(() => {
  for (const name of ALL_ENVS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function envFile(contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "restate-env-"));
  tmpDirs.push(dir);
  const file = path.join(dir, ".env");
  fs.writeFileSync(file, contents);
  return file;
}

const noop = () => {};

describe("decideServeMode", () => {
  test("nothing configured → listen; the signing key becomes an identity key", () => {
    expect(decideServeMode({ envFile: false, log: noop })).toEqual({
      mode: "listen",
      signingPublicKey: undefined,
    });
    process.env.RESTATE_SIGNING_PUBLIC_KEY = "publickeyv1_abc";
    expect(decideServeMode({ envFile: false, log: noop })).toEqual({
      mode: "listen",
      signingPublicKey: "publickeyv1_abc",
    });
  });

  test("environment + credential → connect, with source, region and ingress for the banner", () => {
    process.env.RESTATE_ENVIRONMENT_ID = "env_abc";
    process.env.RESTATE_AUTH_TOKEN = "key_x";
    process.env.RESTATE_CLOUD_REGION = "eu";
    process.env.RESTATE_INGRESS_URL = "https://abc.env.eu.restate.cloud:8080";
    expect(decideServeMode({ envFile: false, log: noop })).toEqual({
      mode: "connect",
      environmentId: "env_abc",
      discovery: "eu",
      source: "the process environment",
      ingressUrl: "https://abc.env.eu.restate.cloud:8080",
    });
    // The RESTATE_INPROC_* names (operator contract) also select connect mode,
    // and a token file counts as a credential.
    delete process.env.RESTATE_ENVIRONMENT_ID;
    delete process.env.RESTATE_AUTH_TOKEN;
    process.env.RESTATE_INPROC_ENVIRONMENT_ID = "env_inproc";
    process.env.RESTATE_INPROC_AUTH_TOKEN_FILE = "/run/secrets/token";
    expect(decideServeMode({ envFile: false, log: noop })).toMatchObject({
      mode: "connect",
      environmentId: "env_inproc",
    });
  });

  test("half a configuration fails fast, naming the missing variable and `restate cloud link`", () => {
    process.env.RESTATE_ENVIRONMENT_ID = "env_abc";
    expect(() => decideServeMode({ envFile: false, log: noop })).toThrow(
      /env_abc.*RESTATE_AUTH_TOKEN.*restate cloud link.*mode: "listen"/
    );
    delete process.env.RESTATE_ENVIRONMENT_ID;
    process.env.RESTATE_AUTH_TOKEN = "key_x";
    expect(() => decideServeMode({ envFile: false, log: noop })).toThrow(
      /RESTATE_ENVIRONMENT_ID.*restate cloud link/
    );
    // An explicit mode: "connect" with nothing set is an error too, never a
    // silent listener.
    delete process.env.RESTATE_AUTH_TOKEN;
    expect(() =>
      decideServeMode({ mode: "connect", envFile: false, log: noop })
    ).toThrow(/RESTATE_ENVIRONMENT_ID and RESTATE_AUTH_TOKEN/);
  });

  test("an explicit mode wins over the environment; explicit connect options win over variables", () => {
    process.env.RESTATE_ENVIRONMENT_ID = "env_abc";
    process.env.RESTATE_AUTH_TOKEN = "key_x";
    expect(
      decideServeMode({ mode: "listen", envFile: false, log: noop }).mode
    ).toBe("listen");
    delete process.env.RESTATE_ENVIRONMENT_ID;
    delete process.env.RESTATE_AUTH_TOKEN;
    process.env.RESTATE_CLOUD_REGION = "eu";
    expect(
      decideServeMode({
        connect: {
          environmentId: "env_explicit",
          authToken: "key_explicit",
          tunnelServersSrv: "tunnel.byoc.example",
        },
        envFile: false,
        log: noop,
      })
    ).toMatchObject({
      mode: "connect",
      environmentId: "env_explicit",
      discovery: "tunnel.byoc.example",
      source: "serve() options",
    });
  });

  test("loads the env file without overriding, logs it once, and reports it as the source", () => {
    const file = envFile(
      "RESTATE_ENVIRONMENT_ID=env_file\nRESTATE_AUTH_TOKEN=key_file\nRESTATE_CLOUD_REGION=us\nRESTATE_TUNNEL_NAME=from-file\n"
    );
    process.env.RESTATE_TUNNEL_NAME = "from-process";
    const logs: string[] = [];
    const decision = decideServeMode({
      envFile: file,
      log: (m) => logs.push(m),
    });
    expect(decision).toMatchObject({
      mode: "connect",
      environmentId: "env_file",
      discovery: "us",
      source: file,
    });
    expect(logs).toEqual([`loaded ${file}`]);
    expect(process.env.RESTATE_TUNNEL_NAME).toBe("from-process");
    expect(process.env.RESTATE_AUTH_TOKEN).toBe("key_file");

    // A missing file is silently skipped; envFile: false loads nothing.
    const missing = envFile("");
    fs.rmSync(missing);
    expect(
      decideServeMode({ envFile: missing, log: (m) => logs.push(m) }).mode
    ).toBe("connect"); // the variables above are now in process.env
    expect(logs).toHaveLength(1);
  });
});

describe("tunnel-server discovery from the environment", () => {
  test("RESTATE_CLOUD_REGION → SRV → explicit servers → RESTATE_INPROC_CLOUD_REGION", () => {
    expect(readDiscoveryEnv()).toBeUndefined();
    process.env.RESTATE_INPROC_CLOUD_REGION = "us";
    expect(readDiscoveryEnv()).toMatchObject({ kind: "region", region: "us" });
    process.env.RESTATE_TUNNEL_SERVERS = "a.example:9080, b.example:9080,";
    expect(readDiscoveryEnv()).toMatchObject({
      kind: "servers",
      tunnelServers: ["a.example:9080", "b.example:9080"],
    });
    process.env.RESTATE_TUNNEL_SERVERS_SRV = "tunnel.byoc.example";
    expect(readDiscoveryEnv()).toMatchObject({
      kind: "srv",
      tunnelServersSrv: "tunnel.byoc.example",
    });
    process.env.RESTATE_CLOUD_REGION = "eu";
    expect(readDiscoveryEnv()).toMatchObject({
      kind: "region",
      region: "eu",
      name: "RESTATE_CLOUD_REGION",
    });
  });
});

describe("deployment URL and registration identifiers", () => {
  test("port is always 9080; base from the region/SRV, else the trailer host", () => {
    const common = { environmentId: "env_abc123", tunnelName: "greeter-mbp" };
    expect(
      buildDeploymentUrl({
        ...common,
        srvName: "tunnel.eu.restate.cloud",
        proxyUrl: "https://tunnel.eu.restate.cloud:9082/abc123/greeter-mbp",
      })
    ).toBe(
      "https://tunnel.eu.restate.cloud:9080/abc123/greeter-mbp/http/in-process/9080/"
    );
    expect(
      buildDeploymentUrl({
        ...common,
        srvName: undefined,
        proxyUrl: "https://proxy.internal.example:9081/abc123/greeter-mbp",
      })
    ).toBe(
      "https://proxy.internal.example:9080/abc123/greeter-mbp/http/in-process/9080/"
    );
    expect(
      buildDeploymentUrl({
        ...common,
        srvName: undefined,
        proxyUrl: "https://tunnel.example/abc123/greeter-mbp",
      })
    ).toBe(
      "https://tunnel.example:9080/abc123/greeter-mbp/http/in-process/9080/"
    );
    expect(registrationIdentifier("greeter-mbp")).toBe("tunnel://greeter-mbp");
    expect(registrationDeepLink("greeter-mbp")).toBe(
      "https://cloud.restate.dev/to/overview?register-deployment=tunnel://greeter-mbp"
    );
  });
});
