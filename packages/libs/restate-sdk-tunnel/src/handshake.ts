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

// The /_/start-tunnel handshake.
// =============================================================================
//
// The tunnel server (the HTTP/2 client on the role-flipped connection)
// opens its FIRST stream as `GET /_/start-tunnel`, with a request body that
// stays open and later delivers HTTP/2 TRAILERS. The exchange:
//
//   1. We answer immediately: `200` whose RESPONSE HEADERS carry our
//      credentials — `authorization: Bearer <token>`,
//      `environment-id: env_<id>`, `tunnel-name: <name>`. Empty body.
//      (We do NOT send `supports-drain` — see connect.ts; advertising it
//      obliges us to implement graceful drain, which v1 does not.)
//   2. The server validates the credentials, then completes the handshake
//      by sending TRAILERS on its still-open request body:
//      `tunnel-status: ok | unauthorized | bad-tunnel-name | too-many-tunnels`
//      plus, on ok: `proxy-url`, `tunnel-url`, `tunnel-name`.
//
// Node gotcha (PoC-verified): the high-level Http2ServerRequest "trailers"
// event does NOT fire. Trailers must be read from the raw stream —
// `req.stream.on("trailers", ...)` — or from `req.trailers` after "end".
// The body must be drained for either to fire.
//
// Outcome taxonomy (drives the reconnect policy in connect.ts):
//   - fatal:     unauthorized, bad-tunnel-name, or a tunnel-name echo
//                mismatch. Configuration errors — redialing cannot fix
//                them, and hammering the auth path is harmful.
//   - retryable: too-many-tunnels (often a previous instance still
//                draining), timeout, malformed/missing trailers, stream
//                errors, and unknown statuses (forward compatibility).

import type * as http2 from "node:http2";

/** What the server tells us about the established tunnel. */
export interface HandshakeInfo {
  tunnelName: string;
  proxyUrl: string;
  tunnelUrl: string;
}

export type HandshakeOutcome =
  | { kind: "ok"; info: HandshakeInfo }
  | { kind: "fatal"; reason: string }
  | { kind: "retryable"; reason: string };

export interface HandshakeCredentials {
  authToken: string;
  environmentId: string;
  tunnelName: string;
}

export const START_TUNNEL_PATH = "/_/start-tunnel";

/** Handshake deadline — mirrors the tunnel server's own 5s timeout. */
export const HANDSHAKE_TIMEOUT_MS = 5_000;

/**
 * Run the receiver side of the /_/start-tunnel exchange on its stream.
 * Resolves with an outcome; never rejects.
 */
export function performHandshake(
  req: http2.Http2ServerRequest,
  res: http2.Http2ServerResponse,
  creds: HandshakeCredentials,
  timeoutMs: number = HANDSHAKE_TIMEOUT_MS
): Promise<HandshakeOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome: HandshakeOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve(outcome);
    };

    const deadline = setTimeout(() => {
      finish({
        kind: "retryable",
        reason: `handshake trailers not received within ${timeoutMs}ms`,
      });
      req.stream.destroy();
    }, timeoutMs);
    deadline.unref();

    const onTrailers = (trailers: http2.IncomingHttpHeaders) => {
      const status = trailers["tunnel-status"];
      if (status !== "ok") {
        if (status === "unauthorized" || status === "bad-tunnel-name") {
          finish({ kind: "fatal", reason: `tunnel-status: ${String(status)}` });
        } else {
          finish({
            kind: "retryable",
            reason: `tunnel-status: ${String(status ?? "<missing>")}`,
          });
        }
        return;
      }
      const tunnelName = trailers["tunnel-name"];
      const proxyUrl = trailers["proxy-url"];
      const tunnelUrl = trailers["tunnel-url"];
      if (
        typeof tunnelName !== "string" ||
        typeof proxyUrl !== "string" ||
        typeof tunnelUrl !== "string"
      ) {
        finish({
          kind: "retryable",
          reason: "handshake ok but proxy-url/tunnel-url/tunnel-name missing",
        });
        return;
      }
      if (tunnelName !== creds.tunnelName) {
        // We requested a specific name; the server must echo it. A different
        // name means our registration URL would not route here.
        finish({
          kind: "fatal",
          reason: `tunnel-name mismatch: requested ${JSON.stringify(creds.tunnelName)}, got ${JSON.stringify(tunnelName)}`,
        });
        return;
      }
      finish({ kind: "ok", info: { tunnelName, proxyUrl, tunnelUrl } });
    };

    // PoC-verified: only the raw stream's "trailers" event fires; also read
    // req.trailers after "end" as a belt-and-braces fallback.
    req.stream.on("trailers", onTrailers);
    req.on("end", () => {
      if (!settled && req.trailers && Object.keys(req.trailers).length > 0) {
        onTrailers(req.trailers);
      }
    });
    req.on("error", (err) => {
      finish({
        kind: "retryable",
        reason: `handshake stream error: ${err.message}`,
      });
    });
    req.stream.on("close", () => {
      finish({
        kind: "retryable",
        reason: "handshake stream closed before trailers",
      });
    });
    // Drain the (empty) body so "end"/"trailers" can fire.
    req.resume();

    // Answer with our credentials. The request side stays open for trailers.
    res.writeHead(200, {
      authorization: `Bearer ${creds.authToken}`,
      "environment-id": creds.environmentId,
      "tunnel-name": creds.tunnelName,
    });
    res.end();
  });
}
