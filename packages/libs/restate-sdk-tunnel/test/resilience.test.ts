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

// Resilience tests: the gap-hunt regressions. Each test pins a failure mode
// found by adversarial review against the Rust ground truth — the handshake
// gate race, dial timeouts, backoff discipline, rollover, lifecycle edges,
// and the liveness watchdog.

import { describe, expect, test } from "vitest";
import * as net from "node:net";
import { once } from "node:events";
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

describe("handshake gate", () => {
  test("a request coalesced with the ok-trailers is served, not 503'd", async () => {
    // The real proxy parks pending invocations and fires them the instant
    // the tunnel registers — the first forwarded HEADERS routinely lands in
    // the same TCP flush as the trailers, BEFORE the engine's handshake
    // promise microtask runs. The gate must park it, not reject it.
    let coalesced: Promise<{ status: number; body: string }> | undefined;
    const fake = await startFakeCloud({
      decideTrailers: () => okTrailers(),
      onTrailersSent: (conn) => {
        // Synchronously after sendTrailers — same tick, same flush.
        coalesced = roundtrip(conn.session, {
          ":method": "GET",
          ":path": "/http/h/9080/discover",
          accept: DISCOVER_ACCEPT,
          "x-restate-signature-scheme": "v1",
          "x-restate-jwt-v1": identity.sign("/discover"),
        });
      },
    });
    const conn = connectTunnel(baseOptions(fake.port));
    try {
      await conn.ready;
      const result = await coalesced!;
      expect(result.status).toBe(200);
      expect(result.body).toContain("greeter");
    } finally {
      await conn.close();
      await fake.close();
    }
  });
});

describe("dial resilience", () => {
  test("a peer that accepts but never completes TLS is timed out and the next target is tried", async () => {
    // A silent TCP server: accepts the connection, never writes (models a
    // dead NLB backend that blackholes the TLS handshake).
    let silentAccepts = 0;
    const silent = net.createServer((socket) => {
      silentAccepts++;
      socket.on("error", () => {});
    });
    silent.listen(0, "127.0.0.1");
    await once(silent, "listening");
    const silentPort = (silent.address() as net.AddressInfo).port;

    const fake = await startFakeCloud({ decideTrailers: () => okTrailers() });
    const conn = connectTunnel({
      ...baseOptions(fake.port),
      // Rotation: attempt 0 hits the silent peer, attempt 1 the good fake.
      tunnelServers: [
        `http://127.0.0.1:${silentPort}`,
        `http://127.0.0.1:${fake.port}`,
      ],
      connectTimeoutMs: 100,
    });
    try {
      await conn.ready; // would hang forever without the connect deadline
      expect(silentAccepts).toBe(1);
      expect(conn.connectionCount).toBe(1);
    } finally {
      await conn.close();
      await fake.close();
      silent.close();
    }
  });

  test("handshake-ok-then-die does NOT reset the backoff (no reconnect storm)", async () => {
    // The fake authorizes every handshake then immediately kills the
    // connection. Short-lived connections must keep compounding the
    // backoff (the Rust client's 5s "opened" guard); without the guard the
    // engine would redial at the ~5ms floor — dozens of connections here.
    const fake = await startFakeCloud({
      decideTrailers: () => okTrailers(),
      onTrailersSent: (conn) => {
        setImmediate(() => conn.session.destroy());
      },
    });
    const conn = connectTunnel(baseOptions(fake.port));
    try {
      await conn.ready;
      await new Promise((r) => setTimeout(r, 400));
      // Growing backoff (5,10,20,40,80,160,200... ±50% jitter) admits ~8
      // connections in 400ms; a floor-rate storm would admit dozens.
      expect(fake.connections.length).toBeGreaterThanOrEqual(2); // it does retry
      expect(fake.connections.length).toBeLessThanOrEqual(15); // but backs off
    } finally {
      await conn.close();
      await fake.close();
    }
  });

  test("reconnects after a served connection ends (rollover)", async () => {
    const fake = await startFakeCloud({ decideTrailers: () => okTrailers() });
    const conn = connectTunnel(baseOptions(fake.port));
    try {
      await conn.ready;
      expect(conn.connectionCount).toBe(1);
      // The cloud drops the connection (rolling restart) — engine redials.
      (await fake.waitForConnection(0)).session.destroy();
      await fake.waitForConnection(1);
      // Second handshake completes.
      await new Promise((r) => setTimeout(r, 100));
      expect(conn.connectionCount).toBe(2);
    } finally {
      await conn.close();
      await fake.close();
    }
  });
});

describe("lifecycle", () => {
  test("close() before the first handshake settles ready and stops the dial", async () => {
    // A fake that stalls the handshake forever.
    const fake = await startFakeCloud({ decideTrailers: () => null });
    const conn = connectTunnel(baseOptions(fake.port));
    const closed = conn.close(); // immediately — races the dial/handshake
    await expect(conn.ready).rejects.toThrow(/closed/);
    await closed; // must resolve, not hang on the in-flight attempt
    await fake.close();
  });

  test("an already-aborted signal prevents any connection", async () => {
    const fake = await startFakeCloud({ decideTrailers: () => okTrailers() });
    const aborted = AbortSignal.abort();
    const conn = connectTunnel({ ...baseOptions(fake.port), signal: aborted });
    try {
      await expect(conn.ready).rejects.toThrow(/closed/);
      await new Promise((r) => setTimeout(r, 100));
      expect(fake.connections.length).toBe(0);
      expect(conn.connectionCount).toBe(0);
    } finally {
      await conn.close();
      await fake.close();
    }
  });
});

describe("liveness watchdog", () => {
  test("missed pings trigger a reconnect (half-open peer)", async () => {
    // TLS variant on purpose: over TLS the fake's h2 session reads via the
    // bridge Duplex, so pausing the raw socket genuinely starves it of our
    // PINGs (on a plaintext socket Node's h2 adopts the raw handle and
    // pause() is ineffective).
    const fs = await import("node:fs");
    const path = await import("node:path");
    const cert = fs.readFileSync(path.join(__dirname, "fixtures", "cert.pem"));
    const key = fs.readFileSync(path.join(__dirname, "fixtures", "key.pem"));
    const fake = await startFakeCloud({
      tls: { cert, key },
      decideTrailers: () => okTrailers(),
    });
    const conn = connectTunnel({
      ...baseOptions(fake.port),
      tunnelServers: [`127.0.0.1:${fake.port}`],
      tls: { ca: cert },
      pingIntervalMs: 40,
      pingTimeoutMs: 25,
      pingMaxMissed: 2,
    });
    try {
      await conn.ready;
      // Freeze the peer: pause its socket so PING acks stop flowing while
      // the connection looks alive (the half-open case the OS never
      // surfaces).
      (await fake.waitForConnection(0)).rawSocket.pause();
      // Watchdog: 2 misses × (40ms interval + 25ms timeout) ≈ 130ms → redial.
      await fake.waitForConnection(1);
      await new Promise((r) => setTimeout(r, 100));
      expect(conn.connectionCount).toBe(2);
    } finally {
      await conn.close();
      await fake.close();
    }
  });
});
