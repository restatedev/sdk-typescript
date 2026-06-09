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

// The tunnel engine.
// =============================================================================
//
// connectTunnel() dials OUT to a Restate Cloud tunnel server and serves
// invocations over that connection — no inbound listener. Per connection:
//
//   dial TCP → TLS (NO ALPN) → wrap in the plain bridge (bridge.ts) →
//   role-flip: we become the HTTP/2 *server* on the socket we dialed →
//   the cloud (h2 client) opens `GET /_/start-tunnel` → handshake.ts →
//   on `tunnel-status: ok`, serve: each forwarded invocation is one h2
//   stream; strip `/<scheme>/<host>/<port>` and hand it to the SDK's
//   endpoint handler. The SDK verifies each request's identity JWT against
//   the stripped path (aud is signed service-relative), so this package
//   does zero crypto.
//
// Reconnect policy: exponential backoff with jitter, reset only after a
// CONFIRMED ok handshake. Handshake statuses split into retryable
// (too-many-tunnels, timeouts, network errors) and fatal (unauthorized,
// bad-tunnel-name, name mismatch) — fatal stops the tunnel and surfaces an
// error instead of hammering the auth path forever.
//
// v1 scope: a single connection (no SRV multi-homing fan-out — redials
// rotate across resolved targets), and no `supports-drain` advertisement
// (graceful drain needs confirmed cloud-side semantics; without advertising
// it the cloud simply drops the connection on rollover and we redial).

import * as net from "node:net";
import * as tls from "node:tls";
import * as http2 from "node:http2";
import { createEndpointHandler } from "@restatedev/restate-sdk";

import type { ConnectTunnelOptions, TunnelConnection } from "./types.js";
import { resolveOptions, buildTlsConnectOptions } from "./options.js";
import { resolveTargets, type Target } from "./targets.js";
import { makePlainBridge } from "./bridge.js";
import {
  performHandshake,
  START_TUNNEL_PATH,
  type HandshakeInfo,
} from "./handshake.js";
import { forwardedTail } from "./forwarded.js";

/** Why a connection ended — drives the reconnect policy. */
type ConnectionOutcome =
  | { kind: "served"; uptimeMs: number } // handshake ok'd, served, then closed → redial
  | { kind: "retryable"; reason: string } // redial with backoff
  | { kind: "fatal"; reason: string }; // stop the tunnel, surface an error

/**
 * Backoff resets only when a served connection stayed up at least this long
 * (mirrors the Rust client's 5s "opened" guard). Without it, a server that
 * authorizes the handshake but immediately drops the connection would be
 * redialed at the backoff floor forever — a full TLS+h2+auth round trip
 * every ~10ms.
 */
const MIN_UPTIME_FOR_BACKOFF_RESET_MS = 5_000;

/**
 * Connect this deployment to a Restate Cloud tunnel and serve `services`
 * over it. Returns immediately; connection management runs in the
 * background until `close()` (or the `signal`) stops it. See
 * {@link TunnelConnection.ready} to await the first successful handshake.
 */
export function connectTunnel(options: ConnectTunnelOptions): TunnelConnection {
  const opts = resolveOptions(options);
  const log = opts.logger;

  // Built once, shared across connections and streams (it is stateless per
  // call). identityKeys delegates per-request JWT verification to the SDK —
  // it checks `aud` against the post-strip `req.url` pathname.
  const sdkHandler = createEndpointHandler({
    services: options.services,
    bidirectional: opts.bidirectional,
    identityKeys: [opts.signingPublicKey],
  });

  let stopped = false;
  let fatalError: Error | undefined;
  let connectionCount = 0;
  let lastInfo: HandshakeInfo | undefined;
  let currentSocket: net.Socket | undefined;

  // Stops in-progress backoff sleeps promptly on close().
  const stopController = new AbortController();

  let readyResolve!: () => void;
  let readyReject!: (err: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  // A caller may never await `ready`; don't turn a fatal handshake into an
  // unhandled rejection.
  ready.catch(() => {});

  // Anchor the event loop: between a session closing and the next redial
  // timer there may be no pending I/O, and a bare awaited promise does not
  // keep Node alive.
  const keepAlive = setInterval(() => {}, 0x7fffffff);

  const dialAndServe = (target: Target): Promise<ConnectionOutcome> =>
    new Promise((resolve) => {
      let settled = false;
      let openedAt: number | undefined; // set when the handshake confirms ok
      let session: http2.Http2Session | undefined;
      let watchdog: NodeJS.Timeout | undefined;
      let firstRequestTimer: NodeJS.Timeout | undefined;

      // "The connection served, then ended" — uptime gates the backoff reset.
      const servedOutcome = (): ConnectionOutcome => ({
        kind: "served",
        uptimeMs: openedAt === undefined ? 0 : Date.now() - openedAt,
      });

      const settle = (outcome: ConnectionOutcome) => {
        if (settled) return;
        settled = true;
        if (watchdog !== undefined) clearInterval(watchdog);
        if (firstRequestTimer !== undefined) clearTimeout(firstRequestTimer);
        clearTimeout(connectTimer);
        stopController.signal.removeEventListener("abort", onStop);
        session?.destroy();
        socket.destroy();
        if (currentSocket === socket) currentSocket = undefined;
        resolve(outcome);
      };

      // close() may race any phase of this attempt (dial, TLS, handshake,
      // serving) — the abort listener tears the attempt down deterministically
      // wherever it is.
      const onStop = () =>
        settle({ kind: "retryable", reason: "tunnel closed" });
      stopController.signal.addEventListener("abort", onStop, { once: true });

      const plaintext = target.plaintext ?? opts.tls === false;
      const tlsOptions = plaintext
        ? undefined
        : buildTlsConnectOptions(opts.tls, target.servername);

      const socket: net.Socket = plaintext
        ? net.connect({ host: target.host, port: target.port })
        : tls.connect({ host: target.host, port: target.port, ...tlsOptions });
      currentSocket = socket;

      // Bound the TCP connect AND the TLS handshake: a peer that accepts the
      // SYN but never completes TLS would otherwise stall this attempt
      // forever (the handshake timer below is only armed once connected).
      // Mirrors the Rust client's connect_timeout (5s default).
      const connectTimer = setTimeout(() => {
        settle({
          kind: "retryable",
          reason: `connect timeout after ${opts.connectTimeoutMs}ms`,
        });
      }, opts.connectTimeoutMs);
      connectTimer.unref();

      socket.on("error", (err: Error) => {
        settle({ kind: "retryable", reason: `socket error: ${err.message}` });
      });
      socket.on("close", () => {
        settle(
          openedAt !== undefined
            ? servedOutcome()
            : {
                kind: "retryable",
                reason: "connection closed before handshake completed",
              }
        );
      });

      socket.once(plaintext ? "connect" : "secureConnect", () => {
        clearTimeout(connectTimer);
        socket.setNoDelay(true);
        log(
          `tunnel: connected to ${target.host}:${target.port}, starting handshake`
        );

        // TLS sockets must be wrapped so Node's http2 runs a cleartext
        // prior-knowledge session (no ALPN was negotiated — see bridge.ts).
        // A plaintext socket already has that shape.
        const stream = plaintext ? socket : makePlainBridge(socket);

        // The handshake gate. The cloud proxy fires parked invocations the
        // instant the tunnel registers — routinely coalescing the ok-trailers
        // and the first forwarded HEADERS into one TCP flush, so a stream can
        // arrive before the handshake promise's microtask has run. Mirroring
        // the Rust client's start_result gate, forwarded streams park on this
        // promise instead of being rejected.
        let handshakePromise: Promise<{ ok: boolean }> | undefined;
        let serving = false;

        const dispatchForwarded = (
          req: http2.Http2ServerRequest,
          res: http2.Http2ServerResponse
        ) => {
          const tail = forwardedTail(req.url ?? "");
          if (tail === null) {
            res.writeHead(400);
            res.end("tunnel: malformed forwarded path");
            return;
          }
          req.url = tail;
          sdkHandler(req, res);
        };

        const h2 = http2.createServer(
          {
            maxSessionMemory: opts.maxSessionMemory,
            settings: {
              maxConcurrentStreams: opts.maxConcurrentStreams,
              initialWindowSize: 1024 * 1024,
              maxFrameSize: 65536,
            },
          },
          (req, res) => {
            const rawPath = (req.url ?? "").split("?")[0];

            if (
              handshakePromise === undefined &&
              req.method === "GET" &&
              rawPath === START_TUNNEL_PATH
            ) {
              if (firstRequestTimer !== undefined)
                clearTimeout(firstRequestTimer);
              handshakePromise = performHandshake(
                req,
                res,
                {
                  authToken: opts.authToken,
                  environmentId: opts.environmentId,
                  tunnelName: opts.tunnelName,
                },
                opts.handshakeTimeoutMs
              ).then((outcome) => {
                if (settled) return { ok: false };
                if (outcome.kind === "ok") {
                  openedAt = Date.now();
                  serving = true;
                  connectionCount++;
                  lastInfo = outcome.info;
                  log(
                    `tunnel: established (name=${outcome.info.tunnelName}, proxy=${outcome.info.proxyUrl})`
                  );
                  readyResolve();
                  startWatchdog();
                  return { ok: true };
                }
                settle(outcome);
                return { ok: false };
              });
              return;
            }

            // Control paths arrive UNPREFIXED (they are cloud-originated, not
            // forwarded invocations) — intercept on the raw path, before any
            // prefix stripping. Distinct from the SDK's own `/health`, which
            // arrives prefixed and flows through dispatch below.
            if (rawPath === "/_/health") {
              res.writeHead(200);
              res.end();
              return;
            }
            if (rawPath === "/_/drain-tunnel") {
              // We do not advertise supports-drain, so this is unexpected —
              // acknowledge it and let the server close on us; the redial
              // loop re-establishes.
              log(
                "tunnel: received /_/drain-tunnel (drain not advertised) — acknowledging"
              );
              res.writeHead(200);
              res.end();
              return;
            }
            if (serving) {
              dispatchForwarded(req, res);
              return;
            }
            if (handshakePromise === undefined) {
              // A forwarded stream before /_/start-tunnel was even opened —
              // not a tunnel server speaking the protocol.
              res.writeHead(503);
              res.end("tunnel: not ready");
              return;
            }
            // Handshake in flight: park the stream on its outcome (bounded by
            // handshakeTimeoutMs) rather than rejecting work the cloud sent
            // the moment it registered the tunnel.
            void handshakePromise.then(({ ok }) => {
              if (settled || res.stream.destroyed) return;
              try {
                if (ok) {
                  dispatchForwarded(req, res);
                } else {
                  res.writeHead(503);
                  res.end("tunnel: not ready");
                }
              } catch {
                // The session may be tearing down under us.
              }
            });
          }
        );

        h2.on("session", (s) => {
          session = s;
          try {
            // Raise the per-connection flow-control window (Node defaults to
            // 64 KiB, throttling aggregate throughput across streams).
            (
              s as unknown as { setLocalWindowSize?: (n: number) => void }
            ).setLocalWindowSize?.(opts.connectionWindowSize);
          } catch {
            // Older Node — per-stream windows still apply.
          }
          s.on("close", () => {
            settle(
              openedAt !== undefined
                ? servedOutcome()
                : {
                    kind: "retryable",
                    reason: "session closed before handshake completed",
                  }
            );
          });
          s.on("error", (err: Error) => {
            settle(
              openedAt !== undefined
                ? servedOutcome()
                : { kind: "retryable", reason: `session error: ${err.message}` }
            );
          });
        });
        h2.on("sessionError", (err: Error) => {
          settle(
            openedAt !== undefined
              ? servedOutcome()
              : { kind: "retryable", reason: `session error: ${err.message}` }
          );
        });

        // The server must open /_/start-tunnel promptly; a peer that never
        // does is not a tunnel server.
        firstRequestTimer = setTimeout(() => {
          if (handshakePromise === undefined) {
            settle({
              kind: "retryable",
              reason: "server never initiated /_/start-tunnel",
            });
          }
        }, opts.handshakeTimeoutMs);
        firstRequestTimer.unref();

        // Liveness watchdog: periodic h2 PING; consecutive misses mean the
        // connection is half-open (the OS may never surface it) — kill and
        // redial. Started only once serving.
        const startWatchdog = () => {
          let missed = 0;
          watchdog = setInterval(() => {
            const s = session;
            if (s === undefined || s.destroyed) return;
            let acked = false;
            try {
              s.ping((err) => {
                if (err === null) {
                  acked = true;
                  missed = 0;
                }
              });
            } catch {
              return;
            }
            const t = setTimeout(() => {
              if (acked || s.destroyed) return;
              missed++;
              if (missed >= opts.pingMaxMissed) {
                log(
                  `tunnel: ${missed} consecutive pings missed — reconnecting`
                );
                settle(servedOutcome());
              }
            }, opts.pingTimeoutMs);
            t.unref();
          }, opts.pingIntervalMs);
          watchdog.unref();
        };

        h2.emit("connection", stream);
      });
    });

  // Exponential backoff with ±50% jitter; reset only after an ok handshake.
  let backoffMs = opts.reconnectInitialMs;
  const nextDelay = (): number => {
    const d = backoffMs;
    backoffMs = Math.min(backoffMs * opts.reconnectFactor, opts.reconnectMaxMs);
    return d * (0.5 + Math.random());
  };

  const loopDone = (async () => {
    let attempt = 0;
    while (!stopped) {
      let outcome: ConnectionOutcome;
      try {
        const targets = await resolveTargets(opts);
        if (stopped) break; // close() may have raced the resolution await
        const target = targets[attempt % targets.length]!;
        attempt++;
        outcome = await dialAndServe(target);
      } catch (err) {
        outcome = {
          kind: "retryable",
          reason: `target resolution failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
      if (stopped) break;
      if (outcome.kind === "fatal") {
        fatalError = new Error(`tunnel: ${outcome.reason}`);
        log(`tunnel: FATAL — ${outcome.reason}; not reconnecting`);
        readyReject(fatalError);
        break;
      }
      if (outcome.kind === "served") {
        // Reset the backoff only when the connection actually held —
        // a handshake-ok-then-die cycle must keep compounding toward
        // reconnectMaxMs (see MIN_UPTIME_FOR_BACKOFF_RESET_MS).
        if (outcome.uptimeMs >= MIN_UPTIME_FOR_BACKOFF_RESET_MS) {
          backoffMs = opts.reconnectInitialMs;
        }
        log("tunnel: connection ended — reconnecting");
      } else {
        log(`tunnel: ${outcome.reason} — reconnecting`);
      }
      await delay(nextDelay(), stopController.signal);
    }
    clearInterval(keepAlive);
    // If the tunnel never established (closed or stopped before the first
    // ok handshake), settle `ready` so awaiting callers don't hang. No-op
    // if it already resolved/rejected.
    readyReject(
      fatalError ?? new Error("tunnel: closed before the first handshake")
    );
  })();

  const close = async (): Promise<void> => {
    if (!stopped) {
      stopped = true;
      stopController.abort();
      currentSocket?.destroy();
      clearInterval(keepAlive);
    }
    await loopDone;
  };

  if (options.signal?.aborted) {
    // An already-aborted signal means "don't run" — stop before dialing.
    void close();
  } else {
    options.signal?.addEventListener("abort", () => void close(), {
      once: true,
    });
  }

  return {
    close,
    get connectionCount() {
      return connectionCount;
    },
    get tunnelName() {
      return lastInfo?.tunnelName;
    },
    get proxyUrl() {
      return lastInfo?.proxyUrl;
    },
    get tunnelUrl() {
      return lastInfo?.tunnelUrl;
    },
    get error() {
      return fatalError;
    },
    ready,
  };
}

/** Sleep that wakes early (resolving) when the signal aborts. */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
