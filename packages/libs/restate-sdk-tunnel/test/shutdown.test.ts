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

// Client-initiated graceful shutdown: on shutdown() the client advertises the
// capability at handshake, refuses NEW invocations with the
// `x-restate-tunnel-draining` sentinel (so the cloud deselects this
// connection) without running them, drains its in-flight invocations, and then
// tears down.

import type * as http2 from "node:http2";
import { describe, expect, test } from "vitest";
import * as restate from "@restatedev/restate-sdk";

import { connectTunnel } from "../src/index.js";
import type { ConnectTunnelOptions } from "../src/index.js";
import { startFakeCloud, roundtrip } from "./fake-cloud.js";
import { generateIdentityKey } from "./identity.js";

const identity = generateIdentityKey();

/**
 * The fake cloud's view of the (role-flipped) session closing is observed
 * asynchronously after the client tears its own side down, so wait for the
 * close event rather than asserting `destroyed` synchronously the moment
 * `shutdown()` resolves.
 */
function waitForClose(
  session: http2.ClientHttp2Session,
  timeoutMs = 2_000
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (session.destroyed) {
      resolve();
      return;
    }
    const timer = setTimeout(
      () => reject(new Error("session did not close in time")),
      timeoutMs
    );
    session.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

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

const baseOptions = (port: number): ConnectTunnelOptions => ({
  tunnelServers: [`http://127.0.0.1:${port}`],
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

/** A forwarded discover invocation — runs the SDK and returns the manifest. */
const discoverReq = () => ({
  ":method": "GET",
  ":path": "/http/h/9080/discover",
  accept: DISCOVER_ACCEPT,
  "x-restate-signature-scheme": "v1",
  "x-restate-jwt-v1": identity.sign("/discover"),
});

describe("client-initiated graceful shutdown", () => {
  test("advertises supports-client-drain by default", async () => {
    const fake = await startFakeCloud({ decideTrailers: () => okTrailers() });
    const conn = connectTunnel(baseOptions(fake.port));
    try {
      await conn.ready;
      const c0 = await fake.waitForConnection(0);
      expect((await c0.creds)["supports-client-drain"]).toBe("true");
    } finally {
      await conn.close();
      await fake.close();
    }
  });

  test("supportsClientDrain: false omits the capability header", async () => {
    const fake = await startFakeCloud({ decideTrailers: () => okTrailers() });
    const conn = connectTunnel({
      ...baseOptions(fake.port),
      supportsClientDrain: false,
    });
    try {
      await conn.ready;
      const c0 = await fake.waitForConnection(0);
      expect((await c0.creds)["supports-client-drain"]).toBeUndefined();
    } finally {
      await conn.close();
      await fake.close();
    }
  });

  test("an idle shutdown() tears the connection down and does not redial", async () => {
    const fake = await startFakeCloud({ decideTrailers: () => okTrailers() });
    const conn = connectTunnel(baseOptions(fake.port));
    try {
      await conn.ready;
      const c0 = await fake.waitForConnection(0);
      // Nothing in flight: shutdown resolves promptly and tears the tunnel down.
      await conn.shutdown();
      await waitForClose(c0.session);
      expect(c0.session.destroyed).toBe(true);
      const seen = fake.connections.length;
      await new Promise((r) => setTimeout(r, 100));
      expect(fake.connections.length).toBe(seen); // no reconnect after shutdown
    } finally {
      await conn.close();
      await fake.close();
    }
  });

  test("drains in-flight invocations while refusing new ones with the sentinel", async () => {
    const fake = await startFakeCloud({ decideTrailers: () => okTrailers() });
    const conn = connectTunnel({ ...baseOptions(fake.port), drainGraceMs: 5_000 });
    try {
      await conn.ready;
      const c0 = await fake.waitForConnection(0);

      // Learn the service-protocol version so we can open a real invocation
      // and hold it in flight (the SDK waits for input on the request stream).
      const disc = await roundtrip(c0.session, discoverReq());
      expect(disc.status).toBe(200);
      const maxVersion = (JSON.parse(disc.body) as { maxProtocolVersion: number })
        .maxProtocolVersion;
      const invokePath = "/invoke/greeter/greet";
      const held = c0.session.request(
        {
          ":method": "POST",
          ":path": `/http/h/9080${invokePath}`,
          "content-type": `application/vnd.restate.invocation.v${maxVersion}`,
          "x-restate-signature-scheme": "v1",
          "x-restate-jwt-v1": identity.sign(invokePath),
        },
        { endStream: false } // keep the request open → invocation stays in flight
      );
      held.on("error", () => {});
      held.resume();
      // Let the forwarded invocation register as in-flight before draining.
      await new Promise((r) => setTimeout(r, 80));

      // Begin graceful shutdown; it must NOT resolve while the invocation runs.
      let shutdownDone = false;
      const done = conn.shutdown().then(() => {
        shutdownDone = true;
      });
      await new Promise((r) => setTimeout(r, 120));
      expect(shutdownDone).toBe(false); // still draining the in-flight invocation

      // A NEW invocation is refused with the sentinel, WITHOUT running the
      // handler (no manifest body) — the cloud will retry it elsewhere.
      const refused = await roundtrip(c0.session, discoverReq());
      expect(refused.status).toBe(503);
      expect(refused.headers["x-restate-tunnel-draining"]).toBe("true");
      expect(refused.body).not.toContain("greeter");

      // The in-flight invocation finishes → shutdown completes and tears down.
      held.close();
      await done;
      expect(shutdownDone).toBe(true);
      await waitForClose(c0.session);
      expect(c0.session.destroyed).toBe(true);
    } finally {
      await conn.close();
      await fake.close();
    }
  });
});
