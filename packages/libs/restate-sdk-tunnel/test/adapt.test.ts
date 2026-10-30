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
import { toConnectOptions } from "../src/adapt.js";

const ENVS = [
  "RESTATE_ENVIRONMENT_ID",
  "RESTATE_INPROC_ENVIRONMENT_ID",
  "RESTATE_CLOUD_REGION",
  "RESTATE_INPROC_CLOUD_REGION",
  "RESTATE_SIGNING_PUBLIC_KEY",
  "RESTATE_INPROC_SIGNING_PUBLIC_KEY",
];
const saved: Record<string, string | undefined> = {};
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
});

describe("connectTunnel() options → connect() options", () => {
  test("the explicit identity becomes a key, the name and tuning move to their places", () => {
    const options = toConnectOptions({
      region: "eu",
      environmentId: "env_abc123",
      authToken: "key_xyz.secret",
      signingPublicKey: "publickeyv1_abc",
      tunnelName: "greeter-v1",
      tunnelWorkerId: "worker-1",
      handshakeTimeoutMs: 300,
      tls: false,
      services: [],
    });
    expect(options.key).toBe(
      "restate://key_xyz.secret@abc123.env.eu.restate.cloud/?signing-key=publickeyv1_abc"
    );
    expect(options.name).toBe("greeter-v1");
    expect(options.connection).toEqual({
      handshakeTimeoutMs: 300,
      tls: false,
      workerId: "worker-1",
      serversSrv: undefined,
      servers: undefined,
    });
    expect(options.services).toEqual([]);
    expect(options.logger).toBeUndefined();
  });

  test("explicit servers and a partial identity: the host comes from the environment, the rest is left to connect()", () => {
    process.env.RESTATE_INPROC_ENVIRONMENT_ID = "env_fromenv";
    const options = toConnectOptions({
      tunnelServers: ["http://127.0.0.1:19080"],
      authToken: "key_x",
      services: [],
    });
    expect(options.key).toBe("restate://key_x@fromenv.env.restate.cloud/");
    expect(options.connection?.servers).toEqual(["http://127.0.0.1:19080"]);

    // An SRV name lends its domain; a region from the environment wins.
    expect(
      toConnectOptions({
        tunnelServersSrv: "tunnel.custom.example",
        environmentId: "env_a",
        services: [],
      }).key
    ).toBe("restate://a.env.custom.example/");
    process.env.RESTATE_INPROC_CLOUD_REGION = "us";
    expect(toConnectOptions({ environmentId: "env_a", services: [] }).key).toBe(
      "restate://a.env.us.restate.cloud/"
    );

    expect(() =>
      toConnectOptions({ environmentId: "abc", services: [] })
    ).toThrow(/env_/);
    delete process.env.RESTATE_INPROC_ENVIRONMENT_ID;
    expect(() => toConnectOptions({ region: "eu", services: [] })).toThrow(
      /environmentId is required.*RESTATE_INPROC_ENVIRONMENT_ID/
    );
  });

  test("no identity fields: no key, connect() resolves everything from the environment", () => {
    const options = toConnectOptions({ services: [] });
    expect(options.key).toBeUndefined();
    expect(options.name).toBeUndefined();
  });

  test("the raw diagnostic hook receives the engine's lines and nothing else", () => {
    const hook: string[] = [];
    const rest: string[] = [];
    const options = toConnectOptions({
      services: [],
      tunnelDiagnosticLogger: (m) => hook.push(m),
      logger: (_params, message) => rest.push(String(message)),
    });
    options.logger!(
      { source: "SYSTEM", level: "debug", replaying: false } as never,
      "tunnel: connected socket"
    );
    options.logger!(
      { source: "SYSTEM", level: "info", replaying: false } as never,
      'Connected as "x"'
    );
    expect(hook).toEqual(["tunnel: connected socket"]);
    expect(rest).toEqual(['Connected as "x"']);
  });
});
