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
// One dial → serve → end cycle against one tunnel server, structured as an
// explicit pipeline of stages driven by `ConnectionAttempt.drive()`:
//
//   dial()       — connect TCP + TLS, verify ALPN h2 (a self-contained stage
//                  that owns its own connect-timeout / abort wiring).
//   establish()  — role-flip: become the HTTP/2 *server* on the socket we
//                  dialed; obtain the session.
//   handshake    — the cloud (h2 client) opens `GET /_/start-tunnel`; we run
//                  the credentials/trailers exchange (handshake.ts).
//   serve        — each forwarded invocation is one h2 stream; strip
//                  `/<scheme>/<host>/<port>` and hand it to the SDK handler.
//
// The lifecycle is one explicit `AttemptState` value (below) rather than a
// handful of booleans that can drift apart. Cross-cutting concerns are pulled
// into single-responsibility units that own their own mutable state, so the
// orchestrator holds almost none: `dial()` (connect), `Completion` (resolve
// `run()` once), `Watchdog` (liveness ping), and `classifyRequest()` (pure
// request routing). Two behaviours that do NOT fit one linear phase:
//
//   * `run()`-resolution is decoupled from session teardown. A *server* drain
//     resolves `run()` immediately (so the slot redials) while the detached
//     session keeps serving its in-flight invocations from the
//     DrainingRegistry — the zero-drop property.
//   * New-invocation refusal during shutdown is engine-wide, so it is gated on
//     `deps.isShuttingDown()` in addition to this connection's own state.

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

/** A request classified by its (control or forwarded) intent — pure routing. */
type TunnelRequest =
  | { kind: "start-tunnel" } // the cloud opening the handshake stream
  | { kind: "health" } // GET /_/health liveness probe
  | { kind: "drain" } // /_/drain-tunnel: the cloud asks us to rotate
  | { kind: "forwarded" }; // anything else: a forwarded invocation

/** Classify an incoming h2 request. Control paths are cloud-originated and
 * arrive UNPREFIXED (before any destination-prefix stripping). */
function classifyRequest(req: http2.Http2ServerRequest): TunnelRequest {
  const rawPath = (req.url ?? "").split("?")[0];
  if (req.method === "GET" && rawPath === START_TUNNEL_PATH) {
    return { kind: "start-tunnel" };
  }
  if (rawPath === "/_/health") return { kind: "health" };
  if (rawPath === "/_/drain-tunnel") return { kind: "drain" };
  return { kind: "forwarded" };
}

/** Resolves a connection attempt's outcome exactly once. */
class Completion {
  private done = false;
  private resolveFn!: (outcome: ConnectionOutcome) => void;
  readonly promise: Promise<ConnectionOutcome> = new Promise((resolve) => {
    this.resolveFn = resolve;
  });

  get settled(): boolean {
    return this.done;
  }

  /** Resolve once; returns false if it was already resolved. */
  resolve(outcome: ConnectionOutcome): boolean {
    if (this.done) return false;
    this.done = true;
    this.resolveFn(outcome);
    return true;
  }
}

/**
 * Liveness watchdog: periodic h2 PING; `pingMaxMissed` consecutive misses mean
 * the connection is half-open (the OS may never surface it), so `onDead` fires.
 * Owns its own timer/miss state so the connection doesn't have to.
 */
class Watchdog {
  private interval: NodeJS.Timeout | undefined;
  private missed = 0;

  constructor(
    private readonly session: http2.Http2Session,
    private readonly opts: ResolvedOptions,
    private readonly onDead: () => void
  ) {}

  start(): void {
    this.interval = setInterval(() => this.beat(), this.opts.pingIntervalMs);
    this.interval.unref();
  }

  stop(): void {
    if (this.interval !== undefined) clearInterval(this.interval);
  }

  private beat(): void {
    if (this.session.destroyed) return;
    let acked = false;
    try {
      this.session.ping((err) => {
        if (err === null) {
          acked = true;
          this.missed = 0;
        }
      });
    } catch {
      return;
    }
    const t = setTimeout(() => {
      if (acked || this.session.destroyed) return;
      this.missed++;
      if (this.missed >= this.opts.pingMaxMissed) this.onDead();
    }, this.opts.pingTimeoutMs);
    t.unref();
  }
}

/** Connect result: a connected, ALPN-verified socket, or a terminal outcome. */
type DialResult =
  | { ok: true; socket: net.Socket }
  | { ok: false; outcome: ConnectionOutcome };

/**
 * The dial stage: connect TCP (+ TLS), bounded by `connectTimeoutMs` and the
 * slot abort, and require ALPN to have negotiated h2. Owns the socket until it
 * either hands it back connected or destroys it on failure — so all of the
 * connect-phase timer/listener state stays local here.
 */
function dial(
  target: Target,
  deps: ConnectionDeps,
  plaintext: boolean,
  signal: AbortSignal
): Promise<DialResult> {
  const tlsOptions = plaintext
    ? undefined
    : buildTlsConnectOptions(deps.opts.tls, target.servername);
  const socket = plaintext
    ? net.connect({ host: target.host, port: target.port })
    : tls.connect({ host: target.host, port: target.port, ...tlsOptions });

  return new Promise<DialResult>((resolve) => {
    let done = false;
    const onError = (err: Error) => fail(`socket error: ${err.message}`);
    const onAbort = () => fail("tunnel closed");
    const timer = setTimeout(
      () => fail(`connect timeout after ${deps.opts.connectTimeoutMs}ms`),
      deps.opts.connectTimeoutMs
    );
    timer.unref();

    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      socket.removeListener("error", onError);
    };
    function fail(reason: string) {
      if (done) return;
      done = true;
      cleanup();
      socket.destroy();
      resolve({ ok: false, outcome: { kind: "retryable", reason } });
    }

    signal.addEventListener("abort", onAbort, { once: true });
    socket.on("error", onError);
    socket.once(plaintext ? "connect" : "secureConnect", () => {
      if (done) return;
      socket.setNoDelay(true);
      // Node's http2 requires ALPN to have negotiated h2 before it will run a
      // server session over a TLS socket. A server that doesn't negotiate is
      // too old for this client (see the README's server-version note).
      if (!plaintext && (socket as tls.TLSSocket).alpnProtocol !== "h2") {
        fail(
          "tunnel server did not negotiate h2 ALPN — it predates standard-h2 control traffic and cannot serve this client"
        );
        return;
      }
      done = true;
      cleanup();
      resolve({ ok: true, socket });
    });
  });
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
  private readonly completion = new Completion();
  private socket: net.Socket | undefined;
  private watchdog: Watchdog | undefined;
  private firstRequestTimer: NodeJS.Timeout | undefined;

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
  }

  run(): Promise<ConnectionOutcome> {
    this.deps.activeConnections.add(this);
    void this.drive();
    return this.completion.promise;
  }

  /** Stage pipeline: dial → establish (role-flip). The remaining stages
   * (handshake, serve) are event-driven from the h2 server's request handler. */
  private async drive(): Promise<void> {
    const dialed = await dial(
      this.target,
      this.deps,
      this.plaintext,
      this.slotSignal
    );
    // A client-drain (shutdown) or abort may have settled us mid-dial.
    if (this.completion.settled) {
      if (dialed.ok) dialed.socket.destroy();
      this.deps.activeConnections.delete(this);
      return;
    }
    if (!dialed.ok) {
      this.settle(dialed.outcome);
      return;
    }
    this.socket = dialed.socket;
    this.deps.activeSockets.add(dialed.socket);
    this.slotSignal.addEventListener("abort", this.onAbort, { once: true });
    dialed.socket.on("error", (err: Error) =>
      this.settle(this.endOutcome(`socket error: ${err.message}`))
    );
    dialed.socket.on("close", () =>
      this.settle(this.endOutcome("connection closed before handshake completed"))
    );
    this.establish(dialed.socket);
  }

  // ---- state helpers ----

  private get closed(): boolean {
    return this.state.kind === "closed";
  }

  private session(): http2.Http2Session | undefined {
    const s = this.state;
    return s.kind === "handshaking" || s.kind === "serving" || s.kind === "draining"
      ? s.session
      : undefined;
  }

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

  // ---- teardown ----

  private readonly onAbort = () =>
    this.settle({ kind: "retryable", reason: "tunnel closed" });

  /** Release this attempt's own resources (timers, listeners, registries). */
  private release(): void {
    this.watchdog?.stop();
    if (this.firstRequestTimer !== undefined)
      clearTimeout(this.firstRequestTimer);
    this.slotSignal.removeEventListener("abort", this.onAbort);
    this.deps.activeConnections.delete(this);
    if (this.socket !== undefined) this.deps.activeSockets.delete(this.socket);
  }

  /**
   * The single terminal path — resolve the outcome (once), destroy the
   * session/socket, and move to `closed`. Idempotent. A server drain does NOT
   * funnel through here for teardown: it detaches via {@link beginServerDrain}
   * and lets the DrainingRegistry destroy the session later.
   */
  private settle(outcome: ConnectionOutcome): void {
    if (this.closed) return;
    const session = this.session();
    this.release();
    session?.destroy();
    this.socket?.destroy();
    this.state = { kind: "closed" };
    this.completion.resolve(outcome);
  }

  // ---- establish: role-flip ----

  private establish(socket: net.Socket): void {
    this.log(
      `tunnel: connected to ${this.target.host}:${this.target.port}, starting handshake`
    );

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
      s.on("close", () =>
        this.settle(this.endOutcome("session closed before handshake completed"))
      );
      s.on("error", (err: Error) =>
        this.settle(this.endOutcome(`session error: ${err.message}`))
      );
    });
    h2.on("sessionError", (err: Error) =>
      this.settle(this.endOutcome(`session error: ${err.message}`))
    );

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

    h2.emit("connection", socket);
  }

  // ---- request routing ----

  private handleRequest(
    req: http2.Http2ServerRequest,
    res: http2.Http2ServerResponse
  ): void {
    switch (classifyRequest(req).kind) {
      case "health":
        res.writeHead(200);
        res.end();
        return;
      case "drain":
        this.handleDrainRequest(res);
        return;
      case "start-tunnel":
        if (
          this.state.kind === "handshaking" &&
          this.state.handshake === undefined
        ) {
          this.startHandshake(req, res);
        } else {
          res.writeHead(503);
          res.end("tunnel: not ready");
        }
        return;
      case "forwarded":
        this.handleForwarded(req, res);
        return;
    }
  }

  private handleForwarded(
    req: http2.Http2ServerRequest,
    res: http2.Http2ServerResponse
  ): void {
    // Serving, or draining (a server-drained session keeps serving its
    // in-flight; dispatchForwarded refuses only a client drain / shutdown).
    if (this.state.kind === "serving" || this.state.kind === "draining") {
      this.dispatchForwarded(req, res);
      return;
    }
    // A stream that raced the handshake parks on its outcome (the cloud fires
    // work the instant the tunnel registers, coalescing it with the
    // ok-trailers) rather than being rejected.
    if (this.state.kind === "handshaking" && this.state.handshake !== undefined) {
      const handshake = this.state.handshake;
      void handshake.then(({ ok }) => {
        if (this.closed || res.stream.destroyed) return;
        try {
          if (ok) this.dispatchForwarded(req, res);
          else this.notReady(res);
        } catch {
          // The session may be tearing down under us.
        }
      });
      return;
    }
    // Before /_/start-tunnel was even opened (or already gone) — not a tunnel
    // server speaking the protocol.
    this.notReady(res);
  }

  private notReady(res: http2.Http2ServerResponse): void {
    res.writeHead(503);
    res.end("tunnel: not ready");
  }

  /** First stream: run the handshake; its outcome opens the gate. */
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
        this.startWatchdog(session);
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
      // Drain coalesced with the ok-trailers (the server drains tunnels the
      // moment it shuts down, including ones it just registered): the same
      // gate race as forwarded streams — park the drain on the handshake
      // outcome instead of silently dropping it.
      void this.state.handshake.then(({ ok }) => {
        if (ok) this.beginServerDrain();
      });
    }
    // Before /_/start-tunnel was even opened: not a tunnel server
    // speaking the protocol — ack-and-ignore.
  }

  /**
   * Server-initiated drain: detach the still-serving session to the
   * DrainingRegistry and resolve `run()` so the slot dials a replacement. The
   * detached session keeps serving its in-flight invocations under the
   * registry's grace window — `run()` resolves now, the session closes later
   * (its `close` handler then runs `settle()` → `closed`, a no-op resolve).
   */
  private beginServerDrain(): void {
    if (this.state.kind !== "serving") return;
    const { session, openedAt } = this.state;
    this.log("tunnel: drain requested — opening a replacement connection");
    this.release();
    this.deps.draining.add(session, this.socket!, this.deps.opts.drainGraceMs);
    this.state = { kind: "draining", session, openedAt, trigger: "server" };
    this.completion.resolve({ kind: "drained", uptimeMs: this.uptimeMs() });
  }

  /**
   * Client-initiated drain: the engine is shutting this process down. Refuse
   * new invocations and finish in-flight IN PLACE — no redial. The engine
   * waits for in-flight to drain, then tears the connection down.
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

  private startWatchdog(session: http2.Http2Session): void {
    this.watchdog = new Watchdog(session, this.deps.opts, () => {
      this.log("tunnel: pings missed — reconnecting");
      this.settle({ kind: "served", uptimeMs: this.uptimeMs() });
    });
    this.watchdog.start();
  }
}
