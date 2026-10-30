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

// Integration tests: the tunnel engine against a fake cloud tunnel server
// (see fake-cloud.ts), over loopback. Covers the handshake, the
// fatal-vs-retryable reconnect policy, control paths, forwarded dispatch
// into the real SDK handler, the end-to-end identity delegation, and the
// TLS negotiated-h2 bridge path.

import { describe, expect, test } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as restate from "../../src/index.js";

import { connect } from "../../src/endpoint/connect/index.js";
import type { ConnectOptions } from "../../src/endpoint/tunnel/index.js";
import type { LoggerTransport } from "../../src/logging/logger_transport.js";
import {
  startFakeCloud,
  roundtrip,
  type FakeCloudOptions,
} from "./fake-cloud.js";
import { generateIdentityKey } from "./identity.js";

const identity = generateIdentityKey();

const greeter = restate.service({
  name: "greeter",
  handlers: {
    greet: async (_ctx: restate.Context, name: string) => `Hello ${name}`,
  },
});

const TUNNEL_NAME = "test-tunnel";

const okTrailers = (name: string = TUNNEL_NAME): Record<string, string> => ({
  "tunnel-status": "ok",
  "proxy-url": `https://tunnel.example:9080/abc123/${name}`,
  "tunnel-url": "https://tunnel.example:9080",
  "tunnel-name": name,
});

// The connect key for environment env_abc123: the API key in the userinfo
// slot, the signing key and the fake's address as parameters.
const connectKey = (port: number): string =>
  `restate://key_test.secret@abc123.env.example.test/?signing-key=${identity.publicKey}&tunnel-servers=http://127.0.0.1:${port}`;

const baseOptions = (port: number): ConnectOptions => ({
  key: connectKey(port),
  name: TUNNEL_NAME,
  services: [greeter],
  connection: {
    workerId: "worker-test-1",
    handshakeTimeoutMs: 300,
    reconnectRetryPolicy: { initialInterval: 5, maxInterval: 50 },
  },
});

/** A LoggerTransport that collects every message (all levels) into `into`. */
const collect =
  (into: string[]): LoggerTransport =>
  (_params, message) => {
    into.push(String(message));
  };

// The SDK's minimum supported endpoint-manifest version is v2.
const DISCOVER_ACCEPT = "application/vnd.restate.endpointmanifest.v2+json";

async function withFake(
  fakeOptions: FakeCloudOptions,
  run: (
    fake: Awaited<ReturnType<typeof startFakeCloud>>,
    options: ConnectOptions
  ) => Promise<void>
): Promise<void> {
  const fake = await startFakeCloud(fakeOptions);
  try {
    await run(fake, baseOptions(fake.port));
  } finally {
    await fake.close();
  }
}

describe("connect() — handshake", () => {
  test("happy path: handshake completes, credentials presented, info learned", async () => {
    await withFake(
      { decideTrailers: () => okTrailers() },
      async (fake, options) => {
        const conn = connect(options);
        try {
          await conn.ready;
          expect(conn.connectionCount).toBe(1);
          expect(conn.name).toBe(TUNNEL_NAME);
          expect(conn.error).toBeUndefined();

          const creds = await (await fake.waitForConnection(0)).creds;
          expect(creds["authorization"]).toBe("Bearer key_test.secret");
          expect(creds["environment-id"]).toBe("env_abc123");
          expect(creds["tunnel-name"]).toBe(TUNNEL_NAME);
          expect(creds["tunnel-worker-id"]).toBe("worker-test-1");
          expect(creds["tunnel-connection-id"]).toMatch(
            /^[0-9A-HJKMNP-TV-Z]{26}$/
          );
          // Drain is implemented and advertised by default.
          expect(creds["supports-drain"]).toBe("true");
          expect(creds["supports-client-drain"]).toBe("true");
          // The ready-made registration URL: advertised proxy base + the
          // constant in-process destination (routing is by tunnelName).
          expect(conn.deploymentUrl).toBe(
            `${okTrailers()["proxy-url"]}/http/in-process/9080/`
          );
        } finally {
          await conn.close();
        }
      }
    );
  });

  test("diagnostic logger reports connection lifecycle and service readiness", async () => {
    await withFake(
      { decideTrailers: () => okTrailers() },
      async (_fake, options) => {
        const logs: string[] = [];
        const conn = connect({
          ...options,
          logger: collect(logs),
        });
        try {
          await conn.ready;
          const joined = logs.join("\n");
          expect(joined).toMatch(
            /tunnel: using configured tunnel target\(s\):/
          );
          expect(joined).toMatch(
            /tunnel: target set from configured tunnel targets:/
          );
          expect(joined).toMatch(/tunnel: connected socket to .*plaintext/);
          expect(joined).toMatch(
            /worker_id=worker-test-1 connection_id=[0-9A-HJKMNP-TV-Z]{26}/
          );
          expect(joined).toMatch(
            /tunnel: h2 session established to .*localSettings=.*remoteSettings=/
          );
          expect(joined).toMatch(
            /tunnel: established \(name=test-tunnel, proxy=https:\/\/tunnel\.example:9080\/abc123\/test-tunnel\)/
          );
          expect(joined).toMatch(
            /tunnel: service ready \(name=test-tunnel, .*worker_id=worker-test-1, connection_id=[0-9A-HJKMNP-TV-Z]{26}, target=/
          );
        } finally {
          await conn.close();
        }
      }
    );
  });

  test("deploymentUrl normalizes a missing proxy port", async () => {
    await withFake(
      {
        decideTrailers: () => ({
          ...okTrailers(),
          // Public clusters can advertise the proxy without a port.
          "proxy-url": `https://tunnel.example/abc123/${TUNNEL_NAME}`,
        }),
      },
      async (_fake, options) => {
        const conn = connect(options);
        try {
          await conn.ready;
          expect(conn.deploymentUrl).toBe(
            `https://tunnel.example:9080/abc123/${TUNNEL_NAME}/http/in-process/9080/`
          );
        } finally {
          await conn.close();
        }
      }
    );
  });

  test("unauthorized is fatal: error surfaced, no reconnect hammering", async () => {
    await withFake(
      { decideTrailers: () => ({ "tunnel-status": "unauthorized" }) },
      async (fake, options) => {
        const conn = connect(options);
        try {
          await expect(conn.ready).rejects.toThrow(/unauthorized/);
          expect(conn.error?.message).toMatch(/unauthorized/);
          // A config error must not be retried: still exactly one connection
          // after several backoff periods' worth of time.
          await new Promise((r) => setTimeout(r, 150));
          expect(fake.connections.length).toBe(1);
          expect(conn.connectionCount).toBe(0);
        } finally {
          await conn.close();
        }
      }
    );
  });

  test("tunnel-name mismatch is fatal", async () => {
    await withFake(
      { decideTrailers: () => okTrailers("some-other-name") },
      async (_fake, options) => {
        const conn = connect(options);
        try {
          await expect(conn.ready).rejects.toThrow(/tunnel-name mismatch/);
        } finally {
          await conn.close();
        }
      }
    );
  });

  test("too-many-tunnels is retryable: reconnects and succeeds", async () => {
    await withFake(
      {
        decideTrailers: (_creds, index) =>
          index === 0 ? { "tunnel-status": "too-many-tunnels" } : okTrailers(),
      },
      async (fake, options) => {
        const conn = connect(options);
        try {
          await conn.ready;
          expect(fake.connections.length).toBe(2);
          expect(conn.connectionCount).toBe(1);
          expect(conn.error).toBeUndefined();
        } finally {
          await conn.close();
        }
      }
    );
  });

  test("a stalled handshake (no trailers) times out and is retried", async () => {
    await withFake(
      {
        decideTrailers: (_creds, index) => (index === 0 ? null : okTrailers()),
      },
      async (fake, options) => {
        const conn = connect(options);
        try {
          await conn.ready;
          expect(fake.connections.length).toBe(2);
          expect(conn.connectionCount).toBe(1);
        } finally {
          await conn.close();
        }
      }
    );
  });

  test("close() stops the engine and resolves", async () => {
    await withFake(
      { decideTrailers: () => okTrailers() },
      async (fake, options) => {
        const conn = connect(options);
        await conn.ready;
        await conn.close();
        const seen = fake.connections.length;
        await new Promise((r) => setTimeout(r, 100));
        expect(fake.connections.length).toBe(seen); // no redial after close
      }
    );
  });
});

describe("connect() — dispatch", () => {
  test("forwarded /discover with a correctly-signed identity reaches the SDK", async () => {
    await withFake(
      { decideTrailers: () => okTrailers() },
      async (fake, options) => {
        const conn = connect(options);
        try {
          await conn.ready;
          const { session } = await fake.waitForConnection(0);
          // The cloud proxy already stripped /<env>/<tunnel>; what travels
          // down the tunnel is /<scheme>/<host>/<port>/<sdk-path>. The
          // identity JWT's aud is the SERVICE-RELATIVE path — what the SDK
          // sees after our strip.
          const { status, body } = await roundtrip(session, {
            ":method": "GET",
            ":path": "/http/my-svc.cluster.local/9080/discover",
            accept: DISCOVER_ACCEPT,
            "x-restate-signature-scheme": "v1",
            "x-restate-jwt-v1": identity.sign("/discover"),
          });
          expect(status).toBe(200);
          expect(
            JSON.parse(body).services.map((s: { name: string }) => s.name)
          ).toContain("greeter");
        } finally {
          await conn.close();
        }
      }
    );
  });

  test("a request without identity headers is rejected by the SDK (401)", async () => {
    await withFake(
      { decideTrailers: () => okTrailers() },
      async (fake, options) => {
        const conn = connect(options);
        try {
          await conn.ready;
          const { session } = await fake.waitForConnection(0);
          const { status } = await roundtrip(session, {
            ":method": "GET",
            ":path": "/http/h/9080/discover",
            accept: DISCOVER_ACCEPT,
          });
          expect(status).toBe(401);
        } finally {
          await conn.close();
        }
      }
    );
  });

  test("identity signed over the FULL tunnel path fails — aud is the stripped path", async () => {
    await withFake(
      { decideTrailers: () => okTrailers() },
      async (fake, options) => {
        const conn = connect(options);
        try {
          await conn.ready;
          const { session } = await fake.waitForConnection(0);
          const { status } = await roundtrip(session, {
            ":method": "GET",
            ":path": "/http/h/9080/discover",
            accept: DISCOVER_ACCEPT,
            "x-restate-signature-scheme": "v1",
            // Wrong audience: the pre-strip path. The runtime signs the
            // service-relative path; this pins our strip-then-delegate design.
            "x-restate-jwt-v1": identity.sign("/http/h/9080/discover"),
          });
          expect(status).toBe(401);
        } finally {
          await conn.close();
        }
      }
    );
  });

  test("a signed /invoke request routes into the SDK's invoke path", async () => {
    await withFake(
      { decideTrailers: () => okTrailers() },
      async (fake, options) => {
        const conn = connect(options);
        try {
          await conn.ready;
          const { session } = await fake.waitForConnection(0);
          // Identity is verified BEFORE the invoke path's content-type
          // check, so a signed request without a content-type yields 415
          // ("Missing content-type header") — proving both that the strip
          // routed to /invoke/... and that identity passed. (Unsigned would
          // be 401; a wrong path would be 404.)
          const { status } = await roundtrip(session, {
            ":method": "POST",
            ":path": "/http/h/9080/invoke/greeter/greet",
            "x-restate-signature-scheme": "v1",
            "x-restate-jwt-v1": identity.sign("/invoke/greeter/greet"),
          });
          expect(status).toBe(415);
        } finally {
          await conn.close();
        }
      }
    );
  });

  test("/_/health is answered locally (unprefixed control path)", async () => {
    await withFake(
      { decideTrailers: () => okTrailers() },
      async (fake, options) => {
        const conn = connect(options);
        try {
          await conn.ready;
          const { session } = await fake.waitForConnection(0);
          const { status } = await roundtrip(session, {
            ":method": "GET",
            ":path": "/_/health",
          });
          expect(status).toBe(200);
        } finally {
          await conn.close();
        }
      }
    );
  });

  test("a path without the forwarded prefix is a 400", async () => {
    await withFake(
      { decideTrailers: () => okTrailers() },
      async (fake, options) => {
        const conn = connect(options);
        try {
          await conn.ready;
          const { session } = await fake.waitForConnection(0);
          const { status } = await roundtrip(session, {
            ":method": "GET",
            ":path": "/discover",
          });
          expect(status).toBe(400);
        } finally {
          await conn.close();
        }
      }
    );
  });
});

describe("connect() — TLS (negotiated h2)", () => {
  const cert = fs.readFileSync(path.join(__dirname, "fixtures", "cert.pem"));
  const key = fs.readFileSync(path.join(__dirname, "fixtures", "key.pem"));

  test("a server that does not negotiate h2 is rejected with a clear reason", async () => {
    // An old tunnel server (pre standard-h2 control traffic) clears its
    // ALPN list — the handshake completes without a negotiated protocol and
    // this client must refuse it loudly rather than limp along.
    const tlsImport = await import("node:tls");
    const server = tlsImport.createServer({ cert, key }, (s) => {
      s.on("error", () => {});
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;

    const reasons: string[] = [];
    const conn = connect({
      ...baseOptions(0),
      connection: {
        ...baseOptions(0).connection,
        servers: [`127.0.0.1:${port}`],
        tls: { ca: cert },
      },
      logger: collect(reasons),
    });
    try {
      await new Promise((r) => setTimeout(r, 300));
      expect(reasons.join("\n")).toMatch(/did not negotiate h2 ALPN/);
      expect(conn.connectionCount).toBe(0);
    } finally {
      await conn.close();
      server.close();
    }
  });

  test("handshake and signed dispatch work over TLS with negotiated h2", async () => {
    await withFake(
      { tls: { cert, key }, decideTrailers: () => okTrailers() },
      async (fake, options) => {
        const conn = connect({
          ...options,
          connection: {
            ...options.connection,
            // host:port form (no scheme): TLS comes from the tls option.
            servers: [`127.0.0.1:${fake.port}`],
            tls: { ca: cert },
          },
        });
        try {
          await conn.ready;
          expect(conn.connectionCount).toBe(1);
          const { session } = await fake.waitForConnection(0);
          const { status, body } = await roundtrip(session, {
            ":method": "GET",
            ":path": "/http/h/9080/discover",
            accept: DISCOVER_ACCEPT,
            "x-restate-signature-scheme": "v1",
            "x-restate-jwt-v1": identity.sign("/discover"),
          });
          expect(status).toBe(200);
          expect(body).toContain("greeter");
        } finally {
          await conn.close();
        }
      }
    );
  });
});
