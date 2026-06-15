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
// The lifecycle is one explicit `AttemptState` value rather than a handful of
// booleans that can drift out of sync — see the type below. Two things that do
// NOT fit a single linear phase are kept as separate concerns:
//
//   * `run()`-resolution is decoupled from session teardown. A *server* drain
//     resolves `run()` immediately (so the slot redials) while the detached
//     session keeps serving its in-flight invocations from the
//     DrainingRegistry — the zero-drop property. So "the attempt's outcome is
//     decided" and "the session is gone" are distinct events.
//   * New-invocation refusal during shutdown is engine-wide (every connection
//     refuses), so it is also gated on `deps.isShuttingDown()`, not only on
//     this connection's own state.
//
// Lifecycle invariants:
//
//   C1. `run()` resolves EXACTLY ONCE, via `resolve()`. Every terminal path
//       funnels through `settle()` (resolve + destroy + → closed) except the
//       server-drain handover, which resolves early and lets the registry do
//       the eventual teardown.
//   C2. A server drain DETACHES: the still-serving session is handed to the
//       DrainingRegistry (it keeps serving in-flight while the slot dials a
//       replacement). A client drain finishes IN PLACE (no redial) because the
//       whole process is going away.
//   C3. The handshake gate: forwarded streams (and drains) that arrive before
//       the handshake outcome's microtask has run PARK on the handshake
//       promise instead of being rejected — the cloud fires parked work the
//       instant the tunnel registers, routinely coalescing it with the
//       ok-trailers in one TCP flush.

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

/**
 * Why a connection is draining.
 *  - `server`: the cloud sent `/_/drain-tunnel` (it is rotating this tunnel
 *    node). We detach + redial; the old session keeps serving in-flight.
 *  - `client`: this process is shutting down (SIGTERM / `shutdown()`). We
 *    refuse new invocations and finish in-flight in place, with no redial.
 */
export type DrainTrigger = "server" | "client";

/**
 * The connection's lifecycle as one explicit value. Each phase carries exactly
 * the data that phase needs, so an illegal combination (e.g. "serving with no
 * session") cannot be represented:
 *
 *   connecting  — dialing the socket + TLS; no h2 session yet.
 *   handshaking — session is up; `handshake` is set once /_/start-tunnel
 *                 arrives (gate streams park on it until it resolves).
 *   serving     — handshake ok'd; forwarding invocations to the SDK.
 *   draining    — winding down; `trigger` records who asked. A `client` drain
 *                 refuses new invocations; a `server` drain keeps serving its
 *                 detached session until the registry closes it.
 *   closed      — terminal; the session/socket are gone.
 */
type AttemptState =
  | { readonly kind: "connecting" }
  | {
      readonly kind: "handshaking";
      readonly session: http2.Http2Session;
      handshake: Promise<{ ok: boolean }> | undefined;
    }
  | {
      readonly kind: "serving";
      readonly session: http2.Http2Session;
      readonly openedAt: number;
    }
  | {
      readonly kind: "draining";
      readonly session: http2.Http2Session;
      readonly openedAt: number;
      readonly trigger: DrainTrigger;
    }
  | { readonly kind: "closed" };

/** The Node request handler produced by the SDK's createEndpointHandler. */
type SdkHandler = ReturnType<
  typeof import("@restatedev/restate-sdk").createEndpointHandler
>;

/**
 * The engine's handle on a live connection: lets `shutdown()` ask each one to
 * begin a client-initiated drain (refuse new, finish in-flight in place).
 */
export interface DrainableConnection {
  beginClientDrain(): void;
}

/** What a connection attempt needs from the engine. */
export interface ConnectionDeps {
  opts: ResolvedOptions;
  /** Built once by the engine; stateless per call, shared across streams. */
  sdkHandler: SdkHandler;
  /** Takes ownership of a detached session on a server-drain handover. */
  draining: DrainingRegistry;
  /** Engine-level socket registry, so close() can destroy in-flight dials. */
  activeSockets: Set<net.Socket>;
  /** Live connections the engine can ask to drain on shutdown(). */
  activeConnections: Set<DrainableConnection>;
  /** Called once per successful handshake (count, learned info, ready). */
  onEstablished: (info: HandshakeInfo) => void;
  /**
   * True once the engine is gracefully shutting down: new forwarded
   * invocations are refused with the drain sentinel instead of dispatched, so
   * the cloud deselects this connection while in-flight invocations finish.
   * Engine-wide (every connection refuses), so it is checked in addition to
   * this connection's own `draining{client}` state.
   */
  isShuttingDown: () => boolean;
  /** A forwarded invocation began executing (counts toward the drain wait). */
  inflightStarted: () => void;
  /** A forwarded invocation finished (its stream closed). */
  inflightEnded: () => void;
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

class ConnectionAttempt implements DrainableConnection {
  private state: AttemptState = { kind: "connecting" };
  /** `run()` resolves exactly once (C1); a server-drain resolves it early. */
  private resolved = false;

  private readonly socket: net.Socket;
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

    deps.activeConnections.add(this);

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

  // ---- state helpers ----

  private get closed(): boolean {
    return this.state.kind === "closed";
  }

  /** The h2 session, for any phase that has one. */
  private session(): http2.Http2Session | undefined {
    const s = this.state;
    return s.kind === "handshaking" || s.kind === "serving" || s.kind === "draining"
      ? s.session
      : undefined;
  }

  /** When the handshake ok'd (the serve epoch), once we've reached it. */
  private get openedAt(): number | undefined {
    const s = this.state;
    return s.kind === "serving" || s.kind === "draining" ? s.openedAt : undefined;
  }

  private uptimeMs(): number {
    return this.openedAt === undefined ? 0 : Date.now() - this.openedAt;
  }

  /** The end-of-connection outcome: "served" once established, else retryable. */
  private endOutcome(reason: string): ConnectionOutcome {
    return this.openedAt !== undefined
      ? { kind: "served", uptimeMs: this.uptimeMs() }
      : { kind: "retryable", reason };
  }

  // ---- lifecycle ----

  private readonly onStop = () =>
    this.settle({ kind: "retryable", reason: "tunnel closed" });

  /** Resolve `run()` once (C1). */
  private resolve(outcome: ConnectionOutcome): void {
    if (this.resolved) return;
    this.resolved = true;
    this.resolveRun(outcome);
  }

  /** Release this attempt's own resources (timers, listeners, registries). */
  private release(): void {
    if (this.watchdog !== undefined) clearInterval(this.watchdog);
    if (this.firstRequestTimer !== undefined)
      clearTimeout(this.firstRequestTimer);
    clearTimeout(this.connectTimer);
    this.slotSignal.removeEventListener("abort", this.onStop);
    this.deps.activeConnections.delete(this);
    this.deps.activeSockets.delete(this.socket);
  }

  /**
   * C1: the single terminal path — resolve the outcome, destroy the
   * session/socket, and move to `closed`. Idempotent. (A server drain does NOT
   * funnel through here for teardown: it detaches via {@link beginServerDrain}
   * and lets the DrainingRegistry destroy the session later.)
   */
  private settle(outcome: ConnectionOutcome): void {
    if (this.closed) return;
    const session = this.session();
    this.release();
    session?.destroy();
    this.socket.destroy();
    this.state = { kind: "closed" };
    this.resolve(outcome);
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
      // Role-flip complete: the cloud is now our h2 client. connecting → handshaking.
      if (this.state.kind === "connecting") {
        this.state = { kind: "handshaking", session: s, handshake: undefined };
      }
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
      if (this.state.kind === "handshaking" && this.state.handshake === undefined) {
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
      this.state.kind === "handshaking" &&
      this.state.handshake === undefined &&
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

    // Serving, or draining (a server-drained session keeps serving its
    // in-flight; dispatchForwarded refuses only a client drain / shutdown).
    if (this.state.kind === "serving" || this.state.kind === "draining") {
      this.dispatchForwarded(req, res);
      return;
    }
    // A stream that raced the handshake parks on its outcome (C3).
    if (this.state.kind === "handshaking" && this.state.handshake !== undefined) {
      this.parkOnGate(req, res);
      return;
    }
    // Before /_/start-tunnel was even opened (or already gone) — not a tunnel
    // server speaking the protocol.
    res.writeHead(503);
    res.end("tunnel: not ready");
  }

  /** First stream: run the handshake; its outcome opens the gate (C3). */
  private startHandshake(
    req: http2.Http2ServerRequest,
    res: http2.Http2ServerResponse
  ): void {
    if (this.state.kind !== "handshaking") return;
    if (this.firstRequestTimer !== undefined)
      clearTimeout(this.firstRequestTimer);
    this.state.handshake = performHandshake(
      req,
      res,
      {
        authToken: this.authToken,
        environmentId: this.deps.opts.environmentId,
        tunnelName: this.deps.opts.tunnelName,
        supportsDrain: this.deps.opts.supportsDrain,
        supportsClientDrain: this.deps.opts.supportsClientDrain,
      },
      this.deps.opts.handshakeTimeoutMs
    ).then((outcome) => {
      // settle (session/socket error) may have raced us to `closed`.
      if (this.state.kind !== "handshaking") return { ok: false };
      if (outcome.kind === "ok") {
        const { session } = this.state;
        const openedAt = Date.now();
        // If our own shutdown began while we were handshaking, open straight
        // into a client drain so this connection refuses work from the start.
        this.state = this.deps.isShuttingDown()
          ? { kind: "draining", session, openedAt, trigger: "client" }
          : { kind: "serving", session, openedAt };
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
    // Client-initiated drain (this connection, or an engine-wide shutdown):
    // refuse new invocations WITHOUT running the handler. The sentinel tells
    // the server to stop routing here; failing the request (rather than
    // running it) lets the runtime retry it on a healthy connection with no
    // risk of double-execution. A *server* drain does not refuse — its
    // detached session keeps serving (the zero-drop property).
    const clientDraining =
      this.state.kind === "draining" && this.state.trigger === "client";
    if (clientDraining || this.deps.isShuttingDown()) {
      res.writeHead(503, { "x-restate-tunnel-draining": "true" });
      res.end();
      return;
    }
    const tail = forwardedTail(req.url ?? "");
    if (tail === null) {
      res.writeHead(400);
      res.end("tunnel: malformed forwarded path");
      return;
    }
    req.url = tail;
    // Count this invocation as in-flight so shutdown() waits for it to finish.
    this.deps.inflightStarted();
    res.stream.once("close", () => this.deps.inflightEnded());
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
    if (this.state.kind !== "handshaking" || this.state.handshake === undefined) {
      res.writeHead(503);
      res.end("tunnel: not ready");
      return;
    }
    void this.state.handshake.then(({ ok }) => {
      if (this.closed || res.stream.destroyed) return;
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
    if (this.state.kind === "serving") {
      this.beginServerDrain();
    } else if (
      this.state.kind === "handshaking" &&
      this.state.handshake !== undefined
    ) {
      // Drain coalesced with the ok-trailers (the server drains tunnels
      // the moment it shuts down, including ones it just registered): the
      // same gate race as forwarded streams — park the drain on the
      // handshake outcome instead of silently dropping it.
      void this.state.handshake.then(({ ok }) => {
        if (ok) this.beginServerDrain();
      });
    }
    // Before /_/start-tunnel was even opened: not a tunnel server
    // speaking the protocol — ack-and-ignore.
  }

  /**
   * Server-initiated drain (C2): detach the still-serving session to the
   * DrainingRegistry and resolve `run()` so the slot dials a replacement. The
   * detached session keeps serving its in-flight invocations under the
   * registry's grace window — `run()` resolves now, the session closes later.
   */
  private beginServerDrain(): void {
    if (this.state.kind !== "serving") return;
    const { session, openedAt } = this.state;
    this.log("tunnel: drain requested — opening a replacement connection");
    // Release our own timers/registrations and hand the socket to the
    // registry, but do NOT destroy the session — it keeps serving.
    this.release();
    this.deps.draining.add(session, this.socket, this.deps.opts.drainGraceMs);
    this.state = { kind: "draining", session, openedAt, trigger: "server" };
    this.resolve({ kind: "drained", uptimeMs: this.uptimeMs() });
    // The session's own close handler (registered in onConnected) will run
    // settle() → closed when the registry destroys it (grace or natural close).
  }

  /**
   * Client-initiated drain (C2): the engine is shutting this process down.
   * Refuse new invocations and finish in-flight IN PLACE — no redial. The
   * engine waits for in-flight to drain, then tears the connection down.
   */
  beginClientDrain(): void {
    const s = this.state;
    switch (s.kind) {
      case "serving":
        this.state = {
          kind: "draining",
          session: s.session,
          openedAt: s.openedAt,
          trigger: "client",
        };
        return;
      case "connecting":
      case "handshaking":
        // No serving session yet — nothing in-flight to protect; abort.
        this.settle({ kind: "retryable", reason: "shutting down" });
        return;
      case "draining":
      case "closed":
        return; // already winding down
    }
  }

  // ---- liveness ----

  /**
   * Periodic h2 PING; consecutive misses mean the connection is half-open
   * (the OS may never surface it) — kill and redial. Started once serving.
   */
  private startWatchdog(): void {
    let missed = 0;
    this.watchdog = setInterval(() => {
      const s = this.session();
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
