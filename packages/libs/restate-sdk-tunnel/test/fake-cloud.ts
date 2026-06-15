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

// A minimal fake of the Restate Cloud tunnel server, for tests.
//
// Accepts inbound TCP/TLS connections and — like the real thing — runs the
// HTTP/2 *client* side over the accepted socket (the role flip): it opens
// `GET /_/start-tunnel` with the request body held open, reads the
// deployment's credential response headers, then completes the handshake by
// sending request TRAILERS decided by the test. Afterwards the test can
// open further streams on the same session to model forwarded invocations.

import * as net from "node:net";
import * as tls from "node:tls";
import * as http2 from "node:http2";
import { Duplex } from "node:stream";

/**
 * Wrap a socket in a plain Duplex. Two reasons the fake needs this for its
 * TLS-accepted sockets: (1) Node's h2 CLIENT enforces ALPN on TLSSockets
 * just like the server side, and the fake's session must run regardless of
 * what was negotiated; (2) a wrapped socket reads via 'data' events, so
 * `rawSocket.pause()` genuinely starves the session — which the watchdog
 * test uses to simulate a half-open peer (pausing a socket natively adopted
 * by h2 has no effect).
 */
function wrapPlain(socket: Duplex): Duplex {
  const wrapped = new Duplex({
    read() {
      socket.resume();
    },
    write(chunk: Buffer, _encoding, callback) {
      socket.write(chunk, callback);
    },
    final(callback) {
      socket.end();
      callback();
    },
    destroy(err, callback) {
      socket.destroy(err ?? undefined);
      callback(err);
    },
  });
  socket.on("data", (chunk: Buffer) => {
    if (!wrapped.push(chunk)) socket.pause();
  });
  socket.on("end", () => wrapped.push(null));
  socket.on("error", (err: Error) => wrapped.destroy(err));
  socket.on("close", () => {
    if (!wrapped.destroyed) wrapped.destroy();
  });
  return wrapped;
}

export interface FakeTunnelConnection {
  /** 0-based order of arrival. */
  index: number;
  /** The deployment's credential headers from its /_/start-tunnel response. */
  creds: Promise<http2.IncomingHttpHeaders>;
  /** The role-flipped h2 client session — open streams to model forwarded requests. */
  session: http2.ClientHttp2Session;
  /** The raw accepted socket (pause it to simulate a half-open peer). */
  rawSocket: Duplex;
}

export interface FakeCloud {
  port: number;
  connections: FakeTunnelConnection[];
  /** Resolves when the index-th connection has arrived. */
  waitForConnection(index: number): Promise<FakeTunnelConnection>;
  close(): Promise<void>;
}

export interface FakeCloudOptions {
  /** Serve TLS (no ALPN — like the real tunnel listener). Plaintext if omitted. */
  tls?: { cert: Buffer; key: Buffer };
  /**
   * Decide the handshake trailers for a connection, given the deployment's
   * credential headers. Return `null` to never send trailers (models a
   * stalled handshake).
   */
  decideTrailers: (
    creds: http2.IncomingHttpHeaders,
    index: number
  ) => Record<string, string> | null;
  /**
   * Called SYNCHRONOUSLY right after the handshake trailers are written —
   * before the next event-loop turn, so anything done here (opening a
   * stream, destroying the session) coalesces with the trailers on the
   * wire, modeling the real proxy firing parked requests the instant the
   * tunnel registers.
   */
  onTrailersSent?: (conn: FakeTunnelConnection) => void;
}

export function startFakeCloud(options: FakeCloudOptions): Promise<FakeCloud> {
  const connections: FakeTunnelConnection[] = [];
  const waiters: Array<{
    index: number;
    resolve: (c: FakeTunnelConnection) => void;
  }> = [];
  const sessions: http2.ClientHttp2Session[] = [];

  const onSocket = (rawSocket: Duplex) => {
    const index = connections.length;
    // Run the h2 CLIENT over the accepted socket (the role flip).
    const socket = options.tls !== undefined ? wrapPlain(rawSocket) : rawSocket;
    const session = http2.connect("http://fake-tunnel-peer", {
      createConnection: () => socket,
    });
    session.on("error", () => {}); // teardown resets are expected in tests
    sessions.push(session);

    let credsResolve!: (h: http2.IncomingHttpHeaders) => void;
    const creds = new Promise<http2.IncomingHttpHeaders>((resolve) => {
      credsResolve = resolve;
    });

    // endStream: false is essential — without it Node sends END_STREAM on
    // the GET HEADERS (no-body request), the request side closes, and
    // trailers can never be sent (`wantTrailers` never fires).
    const req = session.request(
      { ":method": "GET", ":path": "/_/start-tunnel" },
      { endStream: false, waitForTrailers: true }
    );
    req.on("error", () => {});

    // Trailers may only be sent once the stream wants them AND we have read
    // the deployment's response (the real server authorizes the creds first).
    let wantTrailers = false;
    let respHeaders: http2.IncomingHttpHeaders | undefined;
    const maybeFinishHandshake = () => {
      if (!wantTrailers || respHeaders === undefined) return;
      const trailers = options.decideTrailers(respHeaders, index);
      if (trailers !== null) {
        req.sendTrailers(trailers);
        options.onTrailersSent?.(conn);
      }
      // null: leave the request body open forever — handshake stall.
    };
    req.on("wantTrailers", () => {
      wantTrailers = true;
      maybeFinishHandshake();
    });
    req.on("response", (headers) => {
      respHeaders = headers;
      credsResolve(headers);
      maybeFinishHandshake();
    });
    req.resume(); // drain the (empty) response body
    req.end(); // no DATA — triggers wantTrailers

    const conn: FakeTunnelConnection = {
      index,
      creds,
      session,
      rawSocket,
    };
    connections.push(conn);
    for (const w of [...waiters]) {
      if (w.index < connections.length) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(connections[w.index]!);
      }
    }
  };

  const server =
    options.tls !== undefined
      ? tls.createServer(
          {
            cert: options.tls.cert,
            key: options.tls.key,
            // Like the real tunnel server (post standard-h2 control
            // traffic): advertise h2 so the client's required ALPN
            // negotiation succeeds.
            ALPNProtocols: ["h2"],
          },
          onSocket
        )
      : net.createServer(onSocket);

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      resolve({
        port,
        connections,
        waitForConnection(index: number) {
          if (index < connections.length) {
            return Promise.resolve(connections[index]!);
          }
          return new Promise((res) => waiters.push({ index, resolve: res }));
        },
        close() {
          for (const s of sessions) s.destroy();
          return new Promise((res) => server.close(() => res()));
        },
      });
    });
  });
}

/** Collect a full response from a stream opened on a fake connection. */
export function roundtrip(
  session: http2.ClientHttp2Session,
  headers: http2.OutgoingHttpHeaders
): Promise<{
  status: number;
  headers: http2.IncomingHttpHeaders;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const req = session.request(headers);
    let status = 0;
    let responseHeaders: http2.IncomingHttpHeaders = {};
    const chunks: Buffer[] = [];
    req.on("response", (h) => {
      status = Number(h[":status"]);
      responseHeaders = h;
    });
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () =>
      resolve({
        status,
        headers: responseHeaders,
        body: Buffer.concat(chunks).toString(),
      })
    );
    req.on("error", reject);
    req.end();
  });
}
