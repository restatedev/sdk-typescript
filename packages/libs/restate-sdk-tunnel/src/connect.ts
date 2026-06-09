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
// Graceful drain: the engine advertises `supports-drain: true` (default).
// When the cloud rolls a tunnel node it sends `/_/drain-tunnel`; the engine
// detaches the connection — it keeps serving its in-flight invocations for
// up to drainGraceMs — and dials a replacement immediately (no backoff
// sleep), so rollovers drop no requests.
//
// Multi-homing: like the Rust client, the engine connects to EVERY resolved
// tunnel server (one connection per resolved address for SRV discovery; one
// per entry for explicit tunnelServers) and reconciles the set as DNS
// changes — see the slot supervisor below. K is not configurable; it is the
// resolved server set.

import * as net from "node:net";
import * as tls from "node:tls";
import * as http2 from "node:http2";
import { createEndpointHandler } from "@restatedev/restate-sdk";

import type { ConnectTunnelOptions, TunnelConnection } from "./types.js";
import { resolveOptions, buildTlsConnectOptions } from "./options.js";
import { resolveTargets, targetKey, type Target } from "./targets.js";
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
  | { kind: "drained"; uptimeMs: number } // server asked us to rotate → redial IMMEDIATELY
  | { kind: "retryable"; reason: string } // redial with backoff
  | { kind: "fatal"; reason: string }; // stop the tunnel, surface an error

/** A connection handed off for graceful drain: still serving its in-flight
 *  streams, bounded by drainGraceMs, torn down on close(). */
interface DrainingConnection {
  session: http2.Http2Session;
  socket: net.Socket;
  timer: NodeJS.Timeout;
}

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
  const activeSockets = new Set<net.Socket>();
  const draining = new Set<DrainingConnection>();

  // Tear down every draining connection. Runs on close() AND on every loop
  // exit (a fatal handshake must not leave a detached session serving — and
  // holding the process alive — for up to drainGraceMs).
  const destroyDraining = () => {
    for (const entry of draining) {
      clearTimeout(entry.timer);
      entry.session.destroy();
      entry.socket.destroy();
    }
    draining.clear();
  };

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

  const dialAndServe = (
    target: Target,
    slotSignal: AbortSignal
  ): Promise<ConnectionOutcome> =>
    new Promise((resolve) => {
      let settled = false;
      let openedAt: number | undefined; // set when the handshake confirms ok
      let session: http2.Http2Session | undefined;
      let watchdog: NodeJS.Timeout | undefined;
      let firstRequestTimer: NodeJS.Timeout | undefined;
      // Set by the /_/drain-tunnel handover: settle WITHOUT destroying the
      // session, handing it to the draining registry instead so in-flight
      // invocations finish while the loop dials a replacement.
      let detachForDrain = false;

      const uptimeMs = () =>
        openedAt === undefined ? 0 : Date.now() - openedAt;

      // "The connection served, then ended" — uptime gates the backoff reset.
      const servedOutcome = (): ConnectionOutcome => ({
        kind: "served",
        uptimeMs: uptimeMs(),
      });

      const settle = (outcome: ConnectionOutcome) => {
        if (settled) return;
        settled = true;
        if (watchdog !== undefined) clearInterval(watchdog);
        if (firstRequestTimer !== undefined) clearTimeout(firstRequestTimer);
        clearTimeout(connectTimer);
        slotSignal.removeEventListener("abort", onStop);
        if (detachForDrain && session !== undefined && !session.destroyed) {
          // Drain handover: keep the old session serving its in-flight
          // streams for up to drainGraceMs (the cloud stops routing new work
          // to it), then tear it down. close() also tears it down.
          const s = session;
          const entry: DrainingConnection = {
            session: s,
            socket,
            timer: setTimeout(() => {
              draining.delete(entry);
              s.destroy();
              socket.destroy();
            }, opts.drainGraceMs),
          };
          entry.timer.unref();
          draining.add(entry);
          s.on("close", () => {
            clearTimeout(entry.timer);
            draining.delete(entry);
            socket.destroy();
          });
        } else {
          session?.destroy();
          socket.destroy();
        }
        activeSockets.delete(socket);
        resolve(outcome);
      };

      // close() (or this slot's removal) may race any phase of this attempt
      // (dial, TLS, handshake, serving) — the abort listener tears the
      // attempt down deterministically wherever it is.
      const onStop = () =>
        settle({ kind: "retryable", reason: "tunnel closed" });
      slotSignal.addEventListener("abort", onStop, { once: true });

      const plaintext = target.plaintext ?? opts.tls === false;
      const tlsOptions = plaintext
        ? undefined
        : buildTlsConnectOptions(opts.tls, target.servername);

      const socket: net.Socket = plaintext
        ? net.connect({ host: target.host, port: target.port })
        : tls.connect({ host: target.host, port: target.port, ...tlsOptions });
      activeSockets.add(socket);

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
                  supportsDrain: opts.supportsDrain,
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
              res.writeHead(200);
              res.end();
              if (!opts.supportsDrain) {
                // Not advertised, so unexpected — acknowledge and let the
                // server close on us; the redial loop re-establishes.
                log(
                  "tunnel: received /_/drain-tunnel (drain not advertised) — acknowledging"
                );
                return;
              }
              const beginDrain = () => {
                if (settled || detachForDrain) return;
                // Handover: detach this connection (it keeps serving its
                // in-flight invocations for up to drainGraceMs) and settle
                // so the loop dials a replacement.
                log(
                  "tunnel: drain requested — opening a replacement connection"
                );
                detachForDrain = true;
                settle({ kind: "drained", uptimeMs: uptimeMs() });
              };
              if (serving) {
                beginDrain();
              } else if (handshakePromise !== undefined) {
                // Drain coalesced with the ok-trailers (the server drains
                // tunnels the moment it shuts down, including ones it just
                // registered): the same gate race as forwarded streams —
                // park the drain on the handshake outcome instead of
                // silently dropping it.
                void handshakePromise.then(({ ok }) => {
                  if (ok) beginDrain();
                });
              }
              // Before /_/start-tunnel was even opened: not a tunnel server
              // speaking the protocol — ack-and-ignore.
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

  // ---- slots: one tunnel connection per resolved server ----
  //
  // Like the Rust client, the engine connects to EVERY resolved tunnel
  // server (one connection per resolved address for SRV discovery; one per
  // entry for explicit tunnelServers) and keeps the set reconciled: servers
  // that appear get a slot, servers that vanish have their slot torn down.
  // Each slot runs its own dial→serve→backoff loop. A fatal handshake on
  // ANY slot stops the whole tunnel — the credentials are shared, so every
  // other slot would hit the same wall.

  interface Slot {
    ctl: AbortController;
    done: Promise<void>;
  }
  const slots = new Map<string, Slot>();

  // Wakes the supervisor out of its re-resolve sleep promptly on close()
  // AND on a fatal (so teardown doesn't wait out resolveIntervalMs).
  const supervisorWake = new AbortController();
  stopController.signal.addEventListener(
    "abort",
    () => supervisorWake.abort(),
    { once: true }
  );

  const stopAllSlots = () => {
    for (const slot of slots.values()) slot.ctl.abort();
    supervisorWake.abort();
  };

  const runSlot = async (target: Target, ctl: AbortController) => {
    // Per-slot exponential backoff with ±50% jitter; reset only after a
    // connection that stayed up (see MIN_UPTIME_FOR_BACKOFF_RESET_MS).
    let backoffMs = opts.reconnectInitialMs;
    const nextDelay = (): number => {
      const d = backoffMs;
      backoffMs = Math.min(
        backoffMs * opts.reconnectFactor,
        opts.reconnectMaxMs
      );
      return d * (0.5 + Math.random());
    };

    while (!stopped && !ctl.signal.aborted && fatalError === undefined) {
      const outcome = await dialAndServe(target, ctl.signal);
      if (stopped || ctl.signal.aborted) break;
      if (outcome.kind === "fatal") {
        fatalError = new Error(`tunnel: ${outcome.reason}`);
        log(`tunnel: FATAL — ${outcome.reason}; stopping all connections`);
        readyReject(fatalError);
        stopAllSlots();
        break;
      }
      if (outcome.kind === "served" || outcome.kind === "drained") {
        // Reset the backoff only when the connection actually held —
        // a handshake-ok-then-die cycle must keep compounding toward
        // reconnectMaxMs.
        if (outcome.uptimeMs >= MIN_UPTIME_FOR_BACKOFF_RESET_MS) {
          backoffMs = opts.reconnectInitialMs;
        }
        if (
          outcome.kind === "drained" &&
          outcome.uptimeMs >= MIN_UPTIME_FOR_BACKOFF_RESET_MS
        ) {
          // A stable connection was asked to rotate and the server is
          // holding the old one open for us — replace it NOW, not after a
          // backoff sleep. A connection drained moments after registering
          // does NOT take this fast path: drain-spam must compound the
          // backoff like any handshake-ok-then-die cycle, or it becomes a
          // zero-delay dial loop that also accumulates draining sessions.
          log("tunnel: draining — reconnecting immediately");
          continue;
        }
        log(
          outcome.kind === "drained"
            ? "tunnel: drained shortly after connecting — reconnecting with backoff"
            : "tunnel: connection ended — reconnecting"
        );
      } else {
        log(`tunnel: ${outcome.reason} — reconnecting`);
      }
      await delay(nextDelay(), ctl.signal);
    }
  };

  const startSlot = (key: string, target: Target) => {
    const ctl = new AbortController();
    // Chain to the global stop so close() cascades; self-detaching.
    stopController.signal.addEventListener("abort", () => ctl.abort(), {
      once: true,
      signal: ctl.signal,
    });
    const slot: Slot = { ctl, done: Promise.resolve() };
    slot.done = runSlot(target, ctl).finally(() => {
      // Guarded: this key may have vanished and re-appeared, in which case
      // a NEWER slot owns it — don't delete someone else's registration.
      if (slots.get(key) === slot) slots.delete(key);
    });
    slots.set(key, slot);
  };

  // The supervisor: resolve the server set, reconcile slots, repeat (for
  // region discovery; an explicit tunnelServers set is fixed and resolved
  // once, like the Rust client's fixed_uri_stream).
  const loopDone = (async () => {
    while (!stopped && fatalError === undefined) {
      let targets: Target[];
      try {
        // Race the (un-abortable) DNS work against the wake signal so
        // close()/fatal don't block on a slow resolver — a late result is
        // discarded by the stopped/fatal check below.
        const resolution = resolveTargets(opts);
        resolution.catch(() => {}); // a late rejection must not be unhandled
        const raced = await raceAbortable(resolution, supervisorWake.signal);
        if (raced === null) break; // woken: stopped or fatal
        targets = raced;
      } catch (err) {
        // Keep whatever slots exist serving; retry the resolution later
        // (the Rust client does the same on SRV failures).
        log(
          `tunnel: target resolution failed: ${err instanceof Error ? err.message : String(err)} — retrying`
        );
        await delay(
          Math.min(5_000, opts.resolveIntervalMs),
          supervisorWake.signal
        );
        continue;
      }
      if (stopped || fatalError !== undefined) break;

      const desired = new Map(targets.map((t) => [targetKey(t), t] as const));
      for (const [key, target] of desired) {
        if (!slots.has(key)) {
          log(`tunnel: starting connection to ${key}`);
          startSlot(key, target);
        }
      }
      for (const [key, slot] of slots) {
        if (!desired.has(key)) {
          log(`tunnel: ${key} no longer resolves — tearing down`);
          slot.ctl.abort();
        }
      }

      if (opts.srvName === undefined) break; // explicit servers: fixed set
      await delay(opts.resolveIntervalMs, supervisorWake.signal);
    }
    // Slots still in the map are live; evicted ones have already settled.
    // No slot can start after the supervisor loop exits.
    await Promise.all([...slots.values()].map((s) => s.done));
    destroyDraining();
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
      stopAllSlots();
      for (const socket of activeSockets) socket.destroy();
      activeSockets.clear();
      destroyDraining();
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

/**
 * Race a promise against a signal: resolves `null` the moment the signal
 * aborts, otherwise passes the promise's result through (rejections
 * propagate). The abort listener is removed when the race settles, so
 * repeated calls against a long-lived signal don't accumulate listeners.
 */
async function raceAbortable<T>(
  promise: Promise<T>,
  signal: AbortSignal
): Promise<T | null> {
  if (signal.aborted) return null;
  let onAbort!: () => void;
  const aborted = new Promise<null>((resolve) => {
    onAbort = () => resolve(null);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
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
