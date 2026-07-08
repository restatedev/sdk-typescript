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
import * as http2 from "node:http2";
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
  reconnectRetryPolicy: { initialInterval: 5, maxInterval: 200 },
});

const DISCOVER_ACCEPT = "application/vnd.restate.endpointmanifest.v2+json";

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (err: Error) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const discoverReq = () => ({
  ":method": "GET",
  ":path": "/http/h/9080/discover",
  accept: DISCOVER_ACCEPT,
  "x-restate-signature-scheme": "v1",
  "x-restate-jwt-v1": identity.sign("/discover"),
});

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

describe("startup readiness gate", () => {
  test("does not connect to the tunnel server until startupReady resolves, then serves", async () => {
    const gate = deferred<void>();
    const fake = await startFakeCloud({ decideTrailers: () => okTrailers() });
    const logs: string[] = [];
    const conn = connectTunnel({
      ...baseOptions(fake.port),
      startupReady: gate.promise,
      tunnelDiagnosticLogger: (m) => logs.push(m),
    });
    try {
      await new Promise((r) => setTimeout(r, 120));
      expect(fake.connections.length).toBe(0);
      expect(conn.connectionCount).toBe(0);
      expect(logs.join("\n")).toMatch(
        /tunnel: waiting for startup readiness gate/
      );

      gate.resolve();
      await conn.ready;
      expect(fake.connections.length).toBe(1);
      expect(logs.join("\n")).toMatch(/tunnel: startup readiness gate passed/);

      const c0 = await fake.waitForConnection(0);
      const result = await roundtrip(c0.session, discoverReq());
      expect(result.status).toBe(200);
      expect(result.body).toContain("greeter");
    } finally {
      await conn.close();
      await fake.close();
    }
  });

  test("a stuck startupReady gate fails fatally without dialing", async () => {
    const fake = await startFakeCloud({ decideTrailers: () => okTrailers() });
    const logs: string[] = [];
    const conn = connectTunnel({
      ...baseOptions(fake.port),
      startupReady: new Promise<void>(() => {}),
      startupReadyTimeoutMs: 20,
      tunnelDiagnosticLogger: (m) => logs.push(m),
    });
    try {
      await expect(conn.ready).rejects.toThrow(
        /startup readiness gate failed: startup readiness gate timed out after 20ms/
      );
      expect(fake.connections.length).toBe(0);
      expect(logs.join("\n")).toMatch(
        /tunnel: waiting for startup readiness gate \(timeoutMs=20\)/
      );
      expect(logs.join("\n")).toMatch(
        /tunnel: FATAL .* startup readiness gate timed out after 20ms/
      );
    } finally {
      await conn.close();
      await fake.close();
    }
  });

  test("close() while startupReady is pending stops cleanly without dialing", async () => {
    const gate = deferred<void>();
    const fake = await startFakeCloud({ decideTrailers: () => okTrailers() });
    const conn = connectTunnel({
      ...baseOptions(fake.port),
      startupReady: gate.promise,
      startupReadyTimeoutMs: 5_000,
    });
    try {
      const start = Date.now();
      await conn.close();
      expect(Date.now() - start).toBeLessThan(500);
      await expect(conn.ready).rejects.toThrow(
        /closed before the first handshake/
      );
      expect(conn.error).toBeUndefined();
      expect(fake.connections.length).toBe(0);
    } finally {
      await fake.close();
    }
  });

  test("a forwarded request before the tunnel handshake gets the not-ready sentinel, never 502", async () => {
    let sessionResolve!: (session: http2.ClientHttp2Session) => void;
    const sessionPromise = new Promise<http2.ClientHttp2Session>((resolve) => {
      sessionResolve = resolve;
    });
    const server = net.createServer((rawSocket) => {
      const session = http2.connect("http://fake-tunnel-peer", {
        createConnection: () => rawSocket,
      });
      session.on("error", () => {});
      sessionResolve(session);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as net.AddressInfo).port;

    const logs: string[] = [];
    const conn = connectTunnel({
      ...baseOptions(port),
      handshakeTimeoutMs: 500,
      tunnelDiagnosticLogger: (m) => logs.push(m),
    });
    try {
      const session = await sessionPromise;
      const result = await roundtrip(session, discoverReq());
      expect(result.status).toBe(503);
      expect(result.status).not.toBe(502);
      expect(result.headers["x-restate-tunnel-draining"]).toBe("true");
      expect(result.body).toContain("tunnel: not ready");
      expect(logs.join("\n")).toMatch(
        /tunnel: refused forwarded stream \d+ before tunnel handshake completed/
      );
    } finally {
      await conn.close();
      server.close();
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
      // Both get a slot; the silent peer's slot keeps timing out and
      // retrying while the good server's slot establishes.
      tunnelServers: [
        `http://127.0.0.1:${silentPort}`,
        `http://127.0.0.1:${fake.port}`,
      ],
      connectTimeoutMs: 100,
    });
    try {
      await conn.ready; // would hang forever without the connect deadline
      expect(silentAccepts).toBeGreaterThanOrEqual(1);
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

describe("graceful drain", () => {
  test("drain triggers an immediate replacement while the old connection keeps serving", async () => {
    const fake = await startFakeCloud({ decideTrailers: () => okTrailers() });
    const conn = connectTunnel(baseOptions(fake.port));
    try {
      await conn.ready;
      const c0 = await fake.waitForConnection(0);
      expect((await c0.creds)["supports-drain"]).toBe("true");

      // The cloud asks this connection to drain.
      const ack = await roundtrip(c0.session, {
        ":method": "GET",
        ":path": "/_/drain-tunnel",
      });
      expect(ack.status).toBe(200);

      // A replacement connection is dialed immediately (no backoff sleep).
      await fake.waitForConnection(1);
      await new Promise((r) => setTimeout(r, 100));
      expect(conn.connectionCount).toBe(2);

      // THE zero-drop property: the OLD session still serves during the
      // grace window (the cloud keeps routing already-parked work to it).
      const onOld = await roundtrip(c0.session, {
        ":method": "GET",
        ":path": "/http/h/9080/discover",
        accept: DISCOVER_ACCEPT,
        "x-restate-signature-scheme": "v1",
        "x-restate-jwt-v1": identity.sign("/discover"),
      });
      expect(onOld.status).toBe(200);
      expect(onOld.body).toContain("greeter");
    } finally {
      await conn.close();
      await fake.close();
    }
  });

  test("a drained connection is torn down after drainGraceMs", async () => {
    const fake = await startFakeCloud({ decideTrailers: () => okTrailers() });
    const conn = connectTunnel({
      ...baseOptions(fake.port),
      drainGraceMs: 80,
    });
    try {
      await conn.ready;
      const c0 = await fake.waitForConnection(0);
      await roundtrip(c0.session, {
        ":method": "GET",
        ":path": "/_/drain-tunnel",
      });
      await fake.waitForConnection(1); // replacement up
      // After the grace window the old session must be gone.
      await new Promise((r) => setTimeout(r, 250));
      expect(c0.session.destroyed).toBe(true);
      expect(conn.connectionCount).toBe(2); // replacement still serving
    } finally {
      await conn.close();
      await fake.close();
    }
  });

  test("supportsDrain: false — header absent, drain acknowledged but ignored", async () => {
    const fake = await startFakeCloud({ decideTrailers: () => okTrailers() });
    const conn = connectTunnel({
      ...baseOptions(fake.port),
      supportsDrain: false,
    });
    try {
      await conn.ready;
      const c0 = await fake.waitForConnection(0);
      expect((await c0.creds)["supports-drain"]).toBeUndefined();
      const ack = await roundtrip(c0.session, {
        ":method": "GET",
        ":path": "/_/drain-tunnel",
      });
      expect(ack.status).toBe(200);
      await new Promise((r) => setTimeout(r, 150));
      // No handover: still the one connection, still serving.
      expect(fake.connections.length).toBe(1);
      expect(conn.connectionCount).toBe(1);
    } finally {
      await conn.close();
      await fake.close();
    }
  });

  test("a drain coalesced with the ok-trailers still triggers the handover", async () => {
    // The server drains tunnels the moment it shuts down — including ones
    // it just registered — so /_/drain-tunnel can land in the same TCP
    // flush as the ok-trailers, before the handshake microtask flips
    // `serving`. The drain must park on the handshake gate like forwarded
    // streams, not be acked-and-dropped.
    let drainAck: Promise<{ status: number; body: string }> | undefined;
    const fake = await startFakeCloud({
      decideTrailers: () => okTrailers(),
      onTrailersSent: (conn) => {
        if (conn.index === 0) {
          drainAck = roundtrip(conn.session, {
            ":method": "GET",
            ":path": "/_/drain-tunnel",
          });
        }
      },
    });
    const conn = connectTunnel(baseOptions(fake.port));
    try {
      await conn.ready;
      expect((await drainAck!).status).toBe(200);
      // The handover must still happen: a replacement connection is dialed.
      await fake.waitForConnection(1);
      await new Promise((r) => setTimeout(r, 100));
      expect(conn.connectionCount).toBe(2);
    } finally {
      await conn.close();
      await fake.close();
    }
  });

  test("a fatal handshake during drain tears the draining connection down", async () => {
    // Drain c0, then reject the replacement's handshake (token rotated
    // mid-rollover). Fatal must stop the WHOLE tunnel — including the
    // detached draining session, which must not keep serving (and pinning
    // the process) for drainGraceMs after the credentials were rejected.
    const fake = await startFakeCloud({
      decideTrailers: (_creds, index) =>
        index === 0 ? okTrailers() : { "tunnel-status": "unauthorized" },
    });
    const conn = connectTunnel({
      ...baseOptions(fake.port),
      drainGraceMs: 60_000, // long: only the fatal teardown can pass this test
    });
    try {
      await conn.ready;
      const c0 = await fake.waitForConnection(0);
      await roundtrip(c0.session, {
        ":method": "GET",
        ":path": "/_/drain-tunnel",
      });
      await fake.waitForConnection(1); // replacement → unauthorized → fatal
      await new Promise((r) => setTimeout(r, 200));
      expect(conn.error?.message).toMatch(/unauthorized/);
      expect(c0.session.destroyed).toBe(true);
    } finally {
      await conn.close();
      await fake.close();
    }
  });

  test("drain-spam compounds the backoff (no zero-delay dial loop)", async () => {
    // A buggy/looping node that drains every fresh connection right after
    // registering it: early drains (< 5s uptime) must pay the compounding
    // backoff like any handshake-ok-then-die cycle — not redial instantly
    // while accumulating draining sessions.
    const fake = await startFakeCloud({
      decideTrailers: () => okTrailers(),
      onTrailersSent: (conn) => {
        void roundtrip(conn.session, {
          ":method": "GET",
          ":path": "/_/drain-tunnel",
        }).catch(() => {});
      },
    });
    const conn = connectTunnel(baseOptions(fake.port));
    try {
      await conn.ready;
      await new Promise((r) => setTimeout(r, 400));
      expect(fake.connections.length).toBeGreaterThanOrEqual(2); // it does retry
      expect(fake.connections.length).toBeLessThanOrEqual(15); // but backs off
    } finally {
      await conn.close();
      await fake.close();
    }
  });

  test("consecutive drains: two draining connections coexist and close() sweeps both", async () => {
    const fake = await startFakeCloud({ decideTrailers: () => okTrailers() });
    const conn = connectTunnel(baseOptions(fake.port));
    try {
      await conn.ready;
      const c0 = await fake.waitForConnection(0);
      await roundtrip(c0.session, {
        ":method": "GET",
        ":path": "/_/drain-tunnel",
      });
      const c1 = await fake.waitForConnection(1);
      await new Promise((r) => setTimeout(r, 100)); // c1 handshake completes
      await roundtrip(c1.session, {
        ":method": "GET",
        ":path": "/_/drain-tunnel",
      });
      await fake.waitForConnection(2);
      // Both drained sessions are still alive within their grace windows…
      expect(c0.session.destroyed).toBe(false);
      expect(c1.session.destroyed).toBe(false);
      // …and close() sweeps the active connection plus both draining ones.
      await conn.close();
      await new Promise((r) => setTimeout(r, 50));
      expect(c0.session.destroyed).toBe(true);
      expect(c1.session.destroyed).toBe(true);
    } finally {
      await fake.close();
    }
  });

  test("close() during drain tears down both connections and resolves", async () => {
    const fake = await startFakeCloud({ decideTrailers: () => okTrailers() });
    const conn = connectTunnel(baseOptions(fake.port));
    try {
      await conn.ready;
      const c0 = await fake.waitForConnection(0);
      await roundtrip(c0.session, {
        ":method": "GET",
        ":path": "/_/drain-tunnel",
      });
      await fake.waitForConnection(1);
      await conn.close(); // old is draining, new is serving — kill both
      await new Promise((r) => setTimeout(r, 50));
      expect(c0.session.destroyed).toBe(true);
      const seen = fake.connections.length;
      await new Promise((r) => setTimeout(r, 100));
      expect(fake.connections.length).toBe(seen); // no redial after close
    } finally {
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
