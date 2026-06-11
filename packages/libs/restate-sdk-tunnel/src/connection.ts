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

// A single tunnel connection attempt.
// =============================================================================
//
// One dial → serve → end cycle against one tunnel server:
//
//   dial TCP → TLS (ALPN must negotiate h2; the tunnel server advertises
//   it) → role-flip: we become the HTTP/2 *server* on the socket we dialed →
//   the cloud (h2 client) opens `GET /_/start-tunnel` → handshake.ts →
//   on `tunnel-status: ok`, serve: each forwarded invocation is one h2
//   stream; strip `/<scheme>/<host>/<port>` and hand it to the SDK's
//   endpoint handler. The SDK verifies each request's identity JWT against
//   the stripped path (aud is signed service-relative), so this package
//   does zero crypto.
//
// Lifecycle invariants:
//
//   C1. `settle(outcome)` runs EXACTLY ONCE per attempt: it clears every
//       timer, detaches the slot-abort listener, releases the socket, and
//       resolves `run()`. Every exit path funnels through it.
//   C2. The connection is torn down on settle — with ONE exception: a
//       drain handover (`detachForDrain`) hands the still-serving session
//       to the DrainingRegistry instead, so in-flight invocations finish
//       while the slot dials a replacement.
//   C3. The handshake gate: forwarded streams (and drains) that arrive
//       before the handshake outcome's microtask has run PARK on the
//       handshake promise instead of being rejected — the cloud fires
//       parked work the instant the tunnel registers, routinely
//       coalescing it with the ok-trailers in one TCP flush.

import * as net from "node:net";
import * as tls from "node:tls";
import * as http2 from "node:http2";

import type { ResolvedOptions } from "./options.js";
import { buildTlsConnectOptions } from "./options.js";
import type { Target } from "./targets.js";
import {
  performHandshake,
  START_TUNNEL_PATH,
  type HandshakeInfo,
} from "./handshake.js";
import { forwardedTail } from "./forwarded.js";
import type { DrainingRegistry } from "./draining.js";

/** Why a connection ended — drives the slot's reconnect policy. */
export type ConnectionOutcome =
  | { kind: "served"; uptimeMs: number } // handshake ok'd, served, then closed → redial
  | { kind: "drained"; uptimeMs: number } // server asked us to rotate → redial promptly
  | { kind: "retryable"; reason: string } // redial with backoff
  | { kind: "fatal"; reason: string }; // stop the tunnel, surface an error

/** The Node request handler produced by the SDK's createEndpointHandler. */
type SdkHandler = ReturnType<
  typeof import("@restatedev/restate-sdk").createEndpointHandler
>;

/** What a connection attempt needs from the engine. */
export interface ConnectionDeps {
  opts: ResolvedOptions;
  /** Built once by the engine; stateless per call, shared across streams. */
  sdkHandler: SdkHandler;
  /** Takes ownership of a detached session on drain handover. */
  draining: DrainingRegistry;
  /** Engine-level socket registry, so close() can destroy in-flight dials. */
  activeSockets: Set<net.Socket>;
  /** Called once per successful handshake (count, learned info, ready). */
  onEstablished: (info: HandshakeInfo) => void;
}

/**
 * Run one connection attempt. Resolves (never rejects) with the outcome
 * when the connection ends; `slotSignal` aborts the attempt at any phase.
 */
export function runConnection(
  target: Target,
  slotSignal: AbortSignal,
  deps: ConnectionDeps
): Promise<ConnectionOutcome> {
  // Resolved once per attempt, before dialing: a file-sourced token is
  // re-read on every redial so rotations are picked up, and a read failure
  // (e.g. mid-rotation) is a retryable outcome rather than a crash.
  let authToken: string;
  try {
    authToken = deps.opts.authToken();
  } catch (err) {
    return Promise.resolve({
      kind: "retryable",
      reason: `auth token unavailable: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
  return new ConnectionAttempt(target, slotSignal, deps, authToken).run();
}

class ConnectionAttempt {
  private settled = false;
  /** Set when the handshake confirms ok — the connection's serve epoch. */
  private openedAt: number | undefined;
  private serving = false;
  /** Assigned when /_/start-tunnel arrives; the gate streams park on (C3). */
  private handshakePromise: Promise<{ ok: boolean }> | undefined;
  /** Drain handover requested — settle detaches instead of destroying (C2). */
  private detachForDrain = false;

  private readonly socket: net.Socket;
  private session: http2.Http2Session | undefined;
  private readonly connectTimer: NodeJS.Timeout;
  private firstRequestTimer: NodeJS.Timeout | undefined;
  private watchdog: NodeJS.Timeout | undefined;

  private resolveRun!: (outcome: ConnectionOutcome) => void;
  private readonly plaintext: boolean;
  private readonly log: (message: string) => void;

  constructor(
    private readonly target: Target,
    private readonly slotSignal: AbortSignal,
    private readonly deps: ConnectionDeps,
    private readonly authToken: string
  ) {
    this.log = deps.opts.logger;
    this.plaintext = target.plaintext ?? deps.opts.tls === false;

    // close() (or this slot's removal) may race any phase of this attempt
    // (dial, TLS, handshake, serving) — the abort listener tears the
    // attempt down deterministically wherever it is.
    slotSignal.addEventListener("abort", this.onStop, { once: true });

    const tlsOptions = this.plaintext
      ? undefined
      : buildTlsConnectOptions(deps.opts.tls, target.servername);
    this.socket = this.plaintext
      ? net.connect({ host: target.host, port: target.port })
      : tls.connect({ host: target.host, port: target.port, ...tlsOptions });
    deps.activeSockets.add(this.socket);

    // Bound the TCP connect AND the TLS handshake: a peer that accepts the
    // SYN but never completes TLS would otherwise stall this attempt
    // forever (the handshake timer below is only armed once connected).
    // Mirrors the Rust client's connect_timeout (5s default).
    this.connectTimer = setTimeout(() => {
      this.settle({
        kind: "retryable",
        reason: `connect timeout after ${deps.opts.connectTimeoutMs}ms`,
      });
    }, deps.opts.connectTimeoutMs);
    this.connectTimer.unref();
  }

  run(): Promise<ConnectionOutcome> {
    return new Promise((resolve) => {
      this.resolveRun = resolve;
      this.socket.on("error", (err: Error) => {
        this.settle({
          kind: "retryable",
          reason: `socket error: ${err.message}`,
        });
      });
      this.socket.on("close", () => {
        this.settle(
          this.endOutcome("connection closed before handshake completed")
        );
      });
      this.socket.once(this.plaintext ? "connect" : "secureConnect", () =>
        this.onConnected()
      );
    });
  }

  // ---- lifecycle ----

  private readonly onStop = () =>
    this.settle({ kind: "retryable", reason: "tunnel closed" });

  private uptimeMs(): number {
    return this.openedAt === undefined ? 0 : Date.now() - this.openedAt;
  }

  /** The end-of-connection outcome: "served" once established, else retryable. */
  private endOutcome(reason: string): ConnectionOutcome {
    return this.openedAt !== undefined
      ? { kind: "served", uptimeMs: this.uptimeMs() }
      : { kind: "retryable", reason };
  }

  /** C1: the single exit point. C2: drain handover detaches instead. */
  private settle(outcome: ConnectionOutcome): void {
    if (this.settled) return;
    this.settled = true;
    if (this.watchdog !== undefined) clearInterval(this.watchdog);
    if (this.firstRequestTimer !== undefined)
      clearTimeout(this.firstRequestTimer);
    clearTimeout(this.connectTimer);
    this.slotSignal.removeEventListener("abort", this.onStop);
    if (
      this.detachForDrain &&
      this.session !== undefined &&
      !this.session.destroyed
    ) {
      // Drain handover: the session keeps serving its in-flight streams
      // under the registry's grace window (the cloud stops routing new
      // work to it).
      this.deps.draining.add(
        this.session,
        this.socket,
        this.deps.opts.drainGraceMs
      );
    } else {
      this.session?.destroy();
      this.socket.destroy();
    }
    this.deps.activeSockets.delete(this.socket);
    this.resolveRun(outcome);
  }

  // ---- connected: role-flip and serve ----

  private onConnected(): void {
    clearTimeout(this.connectTimer);
    this.socket.setNoDelay(true);
    this.log(
      `tunnel: connected to ${this.target.host}:${this.target.port}, starting handshake`
    );

    // The tunnel server advertises ALPN h2 and the dial offers it; Node's
    // http2 requires the negotiation to have succeeded before it will run a
    // server session over a TLS socket. A server that doesn't negotiate is
    // too old for this client (see the README's server-version note).
    if (!this.plaintext) {
      const alpn = (this.socket as tls.TLSSocket).alpnProtocol;
      if (alpn !== "h2") {
        this.settle({
          kind: "retryable",
          reason:
            "tunnel server did not negotiate h2 ALPN — it predates standard-h2 control traffic and cannot serve this client",
        });
        return;
      }
    }
    const stream = this.socket;

    const h2 = http2.createServer(
      {
        maxSessionMemory: this.deps.opts.maxSessionMemory,
        settings: {
          maxConcurrentStreams: this.deps.opts.maxConcurrentStreams,
          initialWindowSize: 1024 * 1024,
          maxFrameSize: 65536,
        },
      },
      (req, res) => this.handleRequest(req, res)
    );

    h2.on("session", (s) => {
      this.session = s;
      try {
        // Raise the per-connection flow-control window (Node defaults to
        // 64 KiB, throttling aggregate throughput across streams).
        (
          s as unknown as { setLocalWindowSize?: (n: number) => void }
        ).setLocalWindowSize?.(this.deps.opts.connectionWindowSize);
      } catch {
        // Older Node — per-stream windows still apply.
      }
      s.on("close", () => {
        this.settle(
          this.endOutcome("session closed before handshake completed")
        );
      });
      s.on("error", (err: Error) => {
        this.settle(this.endOutcome(`session error: ${err.message}`));
      });
    });
    h2.on("sessionError", (err: Error) => {
      this.settle(this.endOutcome(`session error: ${err.message}`));
    });

    // The server must open /_/start-tunnel promptly; a peer that never
    // does is not a tunnel server.
    this.firstRequestTimer = setTimeout(() => {
      if (this.handshakePromise === undefined) {
        this.settle({
          kind: "retryable",
          reason: "server never initiated /_/start-tunnel",
        });
      }
    }, this.deps.opts.handshakeTimeoutMs);
    this.firstRequestTimer.unref();

    h2.emit("connection", stream);
  }

  // ---- request routing ----

  private handleRequest(
    req: http2.Http2ServerRequest,
    res: http2.Http2ServerResponse
  ): void {
    const rawPath = (req.url ?? "").split("?")[0];

    if (
      this.handshakePromise === undefined &&
      req.method === "GET" &&
      rawPath === START_TUNNEL_PATH
    ) {
      this.startHandshake(req, res);
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
      this.handleDrainRequest(res);
      return;
    }

    if (this.serving) {
      this.dispatchForwarded(req, res);
      return;
    }
    if (this.handshakePromise === undefined) {
      // A forwarded stream before /_/start-tunnel was even opened —
      // not a tunnel server speaking the protocol.
      res.writeHead(503);
      res.end("tunnel: not ready");
      return;
    }
    this.parkOnGate(req, res);
  }

  /** First stream: run the handshake; its outcome opens the gate (C3). */
  private startHandshake(
    req: http2.Http2ServerRequest,
    res: http2.Http2ServerResponse
  ): void {
    if (this.firstRequestTimer !== undefined)
      clearTimeout(this.firstRequestTimer);
    this.handshakePromise = performHandshake(
      req,
      res,
      {
        authToken: this.authToken,
        environmentId: this.deps.opts.environmentId,
        tunnelName: this.deps.opts.tunnelName,
        supportsDrain: this.deps.opts.supportsDrain,
      },
      this.deps.opts.handshakeTimeoutMs
    ).then((outcome) => {
      if (this.settled) return { ok: false };
      if (outcome.kind === "ok") {
        this.openedAt = Date.now();
        this.serving = true;
        this.log(
          `tunnel: established (name=${outcome.info.tunnelName}, proxy=${outcome.info.proxyUrl})`
        );
        this.deps.onEstablished(outcome.info);
        this.startWatchdog();
        return { ok: true };
      }
      this.settle(outcome);
      return { ok: false };
    });
  }

  /** Strip the destination prefix and hand the stream to the SDK. */
  private dispatchForwarded(
    req: http2.Http2ServerRequest,
    res: http2.Http2ServerResponse
  ): void {
    const tail = forwardedTail(req.url ?? "");
    if (tail === null) {
      res.writeHead(400);
      res.end("tunnel: malformed forwarded path");
      return;
    }
    req.url = tail;
    this.deps.sdkHandler(req, res);
  }

  /**
   * C3: a stream that raced the handshake parks on its outcome (bounded by
   * handshakeTimeoutMs) rather than rejecting work the cloud sent the
   * moment it registered the tunnel.
   */
  private parkOnGate(
    req: http2.Http2ServerRequest,
    res: http2.Http2ServerResponse
  ): void {
    void this.handshakePromise!.then(({ ok }) => {
      if (this.settled || res.stream.destroyed) return;
      try {
        if (ok) {
          this.dispatchForwarded(req, res);
        } else {
          res.writeHead(503);
          res.end("tunnel: not ready");
        }
      } catch {
        // The session may be tearing down under us.
      }
    });
  }

  // ---- drain ----

  private handleDrainRequest(res: http2.Http2ServerResponse): void {
    res.writeHead(200);
    res.end();
    if (!this.deps.opts.supportsDrain) {
      // Not advertised, so unexpected — acknowledge and let the server
      // close on us; the slot's redial loop re-establishes.
      this.log(
        "tunnel: received /_/drain-tunnel (drain not advertised) — acknowledging"
      );
      return;
    }
    if (this.serving) {
      this.beginDrain();
    } else if (this.handshakePromise !== undefined) {
      // Drain coalesced with the ok-trailers (the server drains tunnels
      // the moment it shuts down, including ones it just registered): the
      // same gate race as forwarded streams — park the drain on the
      // handshake outcome instead of silently dropping it.
      void this.handshakePromise.then(({ ok }) => {
        if (ok) this.beginDrain();
      });
    }
    // Before /_/start-tunnel was even opened: not a tunnel server
    // speaking the protocol — ack-and-ignore.
  }

  /** Handover: detach (C2) and settle so the slot dials a replacement. */
  private beginDrain(): void {
    if (this.settled || this.detachForDrain) return;
    this.log("tunnel: drain requested — opening a replacement connection");
    this.detachForDrain = true;
    this.settle({ kind: "drained", uptimeMs: this.uptimeMs() });
  }

  // ---- liveness ----

  /**
   * Periodic h2 PING; consecutive misses mean the connection is half-open
   * (the OS may never surface it) — kill and redial. Started once serving.
   */
  private startWatchdog(): void {
    let missed = 0;
    this.watchdog = setInterval(() => {
      const s = this.session;
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
        if (missed >= this.deps.opts.pingMaxMissed) {
          this.log(`tunnel: ${missed} consecutive pings missed — reconnecting`);
          this.settle({ kind: "served", uptimeMs: this.uptimeMs() });
        }
      }, this.deps.opts.pingTimeoutMs);
      t.unref();
    }, this.deps.opts.pingIntervalMs);
    this.watchdog.unref();
  }
}
