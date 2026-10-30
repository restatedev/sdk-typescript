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

// serve(): listen vs connect mode, decided from the environment, against the
// fake cloud tunnel server (see tunnel/fake-cloud.ts).

import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import * as restate from "../src/index.js";
import type { LoggerTransport } from "../src/index.js";
import { startFakeCloud } from "./tunnel/fake-cloud.js";
import { generateIdentityKey } from "./tunnel/identity.js";

const identity = generateIdentityKey();

const greeter = restate.service({
  name: "greeter",
  handlers: {
    greet: async (_ctx: restate.Context, name: string) => `Hello ${name}`,
  },
});

const CLOUD_ENVS = [
  "RESTATE_ENVIRONMENT_ID",
  "RESTATE_INPROC_ENVIRONMENT_ID",
  "RESTATE_AUTH_TOKEN",
  "RESTATE_INPROC_AUTH_TOKEN_FILE",
  "RESTATE_CLOUD_REGION",
  "RESTATE_INPROC_CLOUD_REGION",
  "RESTATE_TUNNEL_SERVERS_SRV",
  "RESTATE_TUNNEL_SERVERS",
  "RESTATE_SIGNING_PUBLIC_KEY",
  "RESTATE_INPROC_SIGNING_PUBLIC_KEY",
  "RESTATE_TUNNEL_NAME",
  "RESTATE_INPROC_TUNNEL_NAME",
  "RESTATE_INGRESS_URL",
  "PORT",
];
const saved: Record<string, string | undefined> = {};
const tmpDirs: string[] = [];
beforeEach(() => {
  for (const name of CLOUD_ENVS) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
});
afterEach(() => {
  for (const name of CLOUD_ENVS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function capture(): { logs: string[]; logger: LoggerTransport } {
  const logs: string[] = [];
  return {
    logs,
    logger: (meta, message?: unknown) =>
      logs.push(`${meta.level}: ${String(message)}`),
  };
}

/** Hold a port so a listen attempt fails fast instead of leaving a server open. */
async function occupiedPort(): Promise<{ port: number; release: () => void }> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  return { port, release: () => server.close() };
}

const okTrailers = (name: string) => ({
  "tunnel-status": "ok",
  "proxy-url": `https://tunnel.example:9081/abc123/${name}`,
  "tunnel-url": "https://tunnel.example:9080",
  "tunnel-name": name,
});

describe("serve() — mode detection", () => {
  test("listen mode when nothing is configured, honouring RESTATE_SIGNING_PUBLIC_KEY; mode: 'listen' overrides the Cloud variables", async () => {
    const { port, release } = await occupiedPort();
    try {
      const plain = capture();
      await expect(
        restate.serve({
          services: [greeter],
          port,
          envFile: false,
          logger: plain.logger,
        })
      ).rejects.toThrow(/EADDRINUSE/);
      expect(plain.logs.join("\n")).toContain(
        "Accepting requests without validating request signatures"
      );

      process.env.RESTATE_SIGNING_PUBLIC_KEY = identity.publicKey;
      const signed = capture();
      await expect(
        restate.serve({
          services: [greeter],
          port,
          envFile: false,
          logger: signed.logger,
        })
      ).rejects.toThrow(/EADDRINUSE/);
      expect(signed.logs.join("\n")).toContain(
        `Validating requests using signing keys [${identity.publicKey}]`
      );

      process.env.RESTATE_ENVIRONMENT_ID = "env_abc123";
      process.env.RESTATE_AUTH_TOKEN = "key_test.secret";
      await expect(
        restate.serve({
          services: [greeter],
          port,
          mode: "listen",
          envFile: false,
          logger: capture().logger,
        })
      ).rejects.toThrow(/EADDRINUSE/);
    } finally {
      release();
    }
  });

  test("half a Cloud configuration rejects instead of silently listening", async () => {
    process.env.RESTATE_ENVIRONMENT_ID = "env_abc123";
    await expect(
      restate.serve({ services: [greeter], envFile: false })
    ).rejects.toThrow(/RESTATE_AUTH_TOKEN.*restate cloud link/);
    delete process.env.RESTATE_ENVIRONMENT_ID;
    process.env.RESTATE_AUTH_TOKEN = "key_test.secret";
    await expect(
      restate.serve({ services: [greeter], envFile: false })
    ).rejects.toThrow(/RESTATE_ENVIRONMENT_ID/);
  });
});

describe("serve() — connect mode", () => {
  test("connects from the environment, resolves 0, prints the registration block; .env never overrides", async () => {
    const fake = await startFakeCloud({
      decideTrailers: (creds) => okTrailers(String(creds["tunnel-name"])),
    });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "restate-serve-"));
    tmpDirs.push(dir);
    const envFile = path.join(dir, ".env");
    fs.writeFileSync(
      envFile,
      [
        "RESTATE_ENVIRONMENT_ID=env_abc123",
        "RESTATE_AUTH_TOKEN=key_test.secret",
        `RESTATE_SIGNING_PUBLIC_KEY=${identity.publicKey}`,
        `RESTATE_TUNNEL_SERVERS=http://127.0.0.1:${fake.port}`,
        "RESTATE_TUNNEL_NAME=from-file",
        "RESTATE_INGRESS_URL=https://abc123.env.eu.restate.cloud:8080",
        "",
      ].join("\n")
    );
    // Already set in the process: wins over the file.
    process.env.RESTATE_TUNNEL_NAME = "greeter-laptop";

    const { logs, logger } = capture();
    const stop = new AbortController();
    try {
      const port = await restate.serve({
        services: [greeter],
        envFile,
        logger,
        connect: {
          signal: stop.signal,
          tunnelWorkerId: "worker-test",
          handshakeTimeoutMs: 1_000,
        },
      });
      expect(port).toBe(0);

      const creds = await (await fake.waitForConnection(0)).creds;
      expect(creds["environment-id"]).toBe("env_abc123");
      expect(creds["authorization"]).toBe("Bearer key_test.secret");
      expect(creds["tunnel-name"]).toBe("greeter-laptop");

      const joined = logs.join("\n");
      expect(joined).toContain(`info: loaded ${envFile}`);
      expect(joined).toContain(
        `info: Connecting to Restate Cloud environment env_abc123 (http://127.0.0.1:${fake.port}) — from ${envFile}`
      );
      expect(joined).toContain(
        'info: Connected as deployment "greeter-laptop"'
      );
      expect(joined).toContain(
        "info: Ingress: https://abc123.env.eu.restate.cloud:8080 (clients.connect() is configured)"
      );
      expect(joined).toContain("info: Register it once:");
      expect(joined).toContain(
        "info:   restate deployments register tunnel://greeter-laptop"
      );
      expect(joined).toContain(
        "info:   or open https://cloud.restate.dev/to/overview?register-deployment=tunnel://greeter-laptop"
      );
      // The deployment URL pins the proxy port even though the trailer said 9081.
      expect(joined).toContain(
        "debug: Deployment URL: https://tunnel.example:9080/abc123/greeter-laptop/http/in-process/9080/"
      );
    } finally {
      stop.abort();
      await fake.close();
    }
  });

  test("programmatic connect options; a fatal handshake rejects the serve() promise", async () => {
    const fake = await startFakeCloud({
      decideTrailers: () => ({ "tunnel-status": "unauthorized" }),
    });
    const stop = new AbortController();
    try {
      await expect(
        restate.serve({
          services: [greeter],
          envFile: false,
          logger: capture().logger,
          connect: {
            tunnelServers: [`http://127.0.0.1:${fake.port}`],
            environmentId: "env_abc123",
            authToken: "key_test.secret",
            signingPublicKey: identity.publicKey,
            tunnelName: "greeter-laptop",
            signal: stop.signal,
            handshakeTimeoutMs: 1_000,
          },
        })
      ).rejects.toThrow(/unauthorized/);
    } finally {
      stop.abort();
      await fake.close();
    }
  });
});
