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
// The lifecycle is one explicit `AttemptState` value, and every phase-owned
// resource lives ON the phase that owns it — the handshake timer on
// `handshaking`, the liveness `watchdog` on `serving`/`draining` — so each
// method narrows the state and destructures what it needs (`const { session,
// watchdog } = this.state`) rather than reaching for nullable instance fields.
// Only the two genuinely lifetime-scoped things are fields: `socket` (used for
// teardown in every phase, and handed to the registry on a server drain) and
// `completion` (resolves `run()` exactly once).
//
// Two behaviours don't fit one linear phase:
//   * `run()`-resolution is decoupled from session teardown. A *server* drain
//     resolves `run()` immediately (so the slot redials) while the detached
//     session keeps serving its in-flight invocations from the
//     DrainingRegistry — the zero-drop property.
//   * New-invocation refusal during shutdown is engine-wide, so it is gated on
//     `deps.isShuttingDown()` in addition to this connection's own state.

import * as net from "node:net";
import * as tls from "node:tls";
import * as http2 from "node:http2";
import { randomBytes } from "node:crypto";

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
 *    send GOAWAY, refuse raced invocations, and finish in-flight in place,
 *    with no redial.
 */
export type DrainTrigger = "server" | "client";

const CLIENT_DRAIN_SESSION_CLOSE_TIMEOUT_MS = 1_000;
const TUNNEL_DRAINING_HEADER = "x-restate-tunnel-draining";
const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeBase32(value: bigint, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out = CROCKFORD_BASE32.charAt(Number(value & 31n)) + out;
    value >>= 5n;
  }
  return out;
}

function newTunnelConnectionId(): string {
  let random = 0n;
  for (const byte of randomBytes(10)) {
    random = (random << 8n) | BigInt(byte);
  }
  return `${encodeBase32(BigInt(Date.now()), 10)}${encodeBase32(random, 16)}`;
}

function formatIdentity(workerId: string, connectionId: string): string {
  return `worker_id=${workerId} connection_id=${connectionId}`;
}

function targetLabel(target: Target): string {
  return `${target.host}:${target.port}`;
}

function formatConnectionOutcome(outcome: ConnectionOutcome): string {
  switch (outcome.kind) {
    case "served":
      return `served uptimeMs=${outcome.uptimeMs}`;
    case "drained":
      return `drained uptimeMs=${outcome.uptimeMs}`;
    case "retryable":
      return `retryable reason=${outcome.reason}`;
    case "fatal":
      return `fatal reason=${outcome.reason}`;
  }
}

function formatSettings(settings: http2.Settings): string {
  const entries = Object.entries(settings).filter(
    ([, value]) => value !== undefined
  );
  if (entries.length === 0) return "{}";
  return `{${entries
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(", ")}}`;
}

/** The Node request handler produced by the SDK's createEndpointHandler. */
type SdkHandler = ReturnType<
  typeof import("@restatedev/restate-sdk").createEndpointHandler
>;

/**
 * The engine's handle on a live connection: lets `shutdown()` ask each one to
 * begin and finish a client-initiated drain.
 */
export interface DrainableConnection {
  beginClientDrain(): void;
  finishClientDrain(opts: { force: boolean }): Promise<void>;
}

export interface ConnectionIdentity {
  workerId: string;
  connectionId: string;
  target: string;
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
  onEstablished: (info: HandshakeInfo, identity: ConnectionIdentity) => void;
  /**
   * True once the engine is gracefully shutting down: new forwarded
   * invocations are refused with the drain sentinel instead of dispatched, so
   * the cloud deselects this connection while in-flight invocations finish.
   * Engine-wide (every connection refuses), so it is checked in addition to
   * this connection's own `draining{client}` state.
   */
  isShuttingDown: () => boolean;
  /** True once the startup readiness gate has passed. */
  isStartupReady: () => boolean;
  /** A forwarded invocation began executing (counts toward the drain wait). */
  inflightStarted: () => void;
  /** A forwarded invocation finished (its stream closed). */
  inflightEnded: () => void;
}

/**
 * The connection's lifecycle as one explicit value. Each phase carries exactly
 * the resources it owns, so a method cannot touch a resource that the current
 * phase has no business with:
 *
 *   connecting  — dialing the socket + TLS; no h2 session yet.
 *   handshaking — session is up; `firstRequestTimer` bounds the wait for the
 *                 cloud to open /_/start-tunnel; `handshake` is set once it
 *                 does (gate streams park on it until it resolves).
 *   serving     — handshake ok'd; forwarding invocations to the SDK, with the
 *                 liveness `watchdog` running.
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
      readonly firstRequestTimer: NodeJS.Timeout;
      handshake: Promise<{ ok: boolean }> | undefined;
    }
  | {
      readonly kind: "serving";
      readonly session: http2.Http2Session;
      readonly openedAt: number;
      readonly watchdog: Watchdog;
    }
  | {
      readonly kind: "draining";
      readonly session: http2.Http2Session;
      readonly openedAt: number;
      readonly trigger: DrainTrigger;
      readonly watchdog: Watchdog;
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
  signal: AbortSignal,
  connectionId: string
): Promise<DialResult> {
  const log = deps.opts.logger;
  const identity = formatIdentity(deps.opts.tunnelWorkerId, connectionId);
  const tlsOptions = plaintext
    ? undefined
    : buildTlsConnectOptions(deps.opts.tls, target.servername);
  const socket = plaintext
    ? net.connect({ host: target.host, port: target.port })
    : tls.connect({ host: target.host, port: target.port, ...tlsOptions });

  return new Promise<DialResult>((resolve) => {
    let done = false;
    const label = targetLabel(target);
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
      log(`tunnel: failed to connect to ${label}: ${reason} (${identity})`);
      socket.destroy();
      resolve({ ok: false, outcome: { kind: "retryable", reason } });
    }

    signal.addEventListener("abort", onAbort, { once: true });
    socket.on("error", onError);
    socket.once(plaintext ? "connect" : "secureConnect", () => {
      if (done) return;
      socket.setNoDelay(true);
      const alpn = plaintext
        ? "plaintext"
        : `tls alpn=${JSON.stringify((socket as tls.TLSSocket).alpnProtocol)}`;
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
      log(`tunnel: connected socket to ${label} (${alpn}, ${identity})`);
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
  /** Lifetime-scoped: destroyed on teardown in any phase, handed to the
   * registry on a server drain. */
  private socket: net.Socket | undefined;

  private readonly plaintext: boolean;
  private readonly log: (message: string) => void;
  private readonly connectionId = newTunnelConnectionId();

  constructor(
    private readonly target: Target,
    private readonly slotSignal: AbortSignal,
    private readonly deps: ConnectionDeps,
    private readonly authToken: string
  ) {
    this.log = deps.opts.logger;
    this.plaintext = target.plaintext ?? deps.opts.tls === false;
  }

  private get identity(): ConnectionIdentity {
    return {
      workerId: this.deps.opts.tunnelWorkerId,
      connectionId: this.connectionId,
      target: targetLabel(this.target),
    };
  }

  private identityLog(): string {
    return formatIdentity(this.deps.opts.tunnelWorkerId, this.connectionId);
  }

  private logWithIdentity(message: string): void {
    this.log(`${message} (${this.identityLog()})`);
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
      this.slotSignal,
      this.connectionId
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
      this.settle(
        this.endOutcome(`socket error: ${err.message}`),
        `socket error: ${err.message}`
      )
    );
    dialed.socket.on("close", () =>
      this.settle(
        this.endOutcome("connection closed before handshake completed"),
        "socket closed"
      )
    );
    this.establish(dialed.socket);
  }

  // ---- state helpers ----

  private get closed(): boolean {
    return this.state.kind === "closed";
  }

  private session(): http2.Http2Session | undefined {
    const s = this.state;
    return s.kind === "handshaking" ||
      s.kind === "serving" ||
      s.kind === "draining"
      ? s.session
      : undefined;
  }

  private get openedAt(): number | undefined {
    const s = this.state;
    return s.kind === "serving" || s.kind === "draining"
      ? s.openedAt
      : undefined;
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

  /** Stop the timers/monitors owned by the current phase. */
  private stopPhaseResources(): void {
    const s = this.state;
    if (s.kind === "handshaking") clearTimeout(s.firstRequestTimer);
    else if (s.kind === "serving" || s.kind === "draining") s.watchdog.stop();
  }

  /** Detach from the engine registries and the slot-abort listener. */
  private deregister(): void {
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
  private settle(outcome: ConnectionOutcome, detail?: string): void {
    if (this.closed) return;
    const phase = this.state.kind;
    const session = this.session();
    this.stopPhaseResources();
    this.deregister();
    this.state = { kind: "closed" };
    session?.destroy();
    this.socket?.destroy();
    const firstOutcome = this.completion.resolve(outcome);
    this.logWithIdentity(
      `tunnel: connection to ${targetLabel(this.target)} closed (phase=${phase}, outcome=${formatConnectionOutcome(outcome)}${
        detail === undefined ? "" : `, detail=${detail}`
      }${firstOutcome ? "" : ", already reported"})`
    );
  }

  private closeSessionGracefully(session: http2.Http2Session): Promise<void> {
    return new Promise((resolve) => {
      if (session.closed || session.destroyed) {
        resolve();
        return;
      }
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        this.settle(
          { kind: "served", uptimeMs: this.uptimeMs() },
          "session.close() timed out"
        );
        finish();
      }, CLIENT_DRAIN_SESSION_CLOSE_TIMEOUT_MS);
      timer.unref();
      session.once("close", finish);
      try {
        session.close();
      } catch {
        this.settle(
          this.endOutcome("session close failed"),
          "session close failed"
        );
        finish();
      }
    });
  }

  private sendClientDrainGoaway(session: http2.Http2Session): void {
    if (session.closed || session.destroyed) return;
    try {
      session.goaway(http2.constants.NGHTTP2_NO_ERROR);
      this.logWithIdentity(
        `tunnel: sent client-drain GOAWAY to ${targetLabel(this.target)}`
      );
    } catch (err) {
      this.logWithIdentity(
        `tunnel: failed to send client-drain GOAWAY to ${targetLabel(this.target)}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      // The session may be closing under us. dispatchForwarded still refuses
      // any raced streams once the state flips to client-draining.
    }
  }

  // ---- establish: role-flip ----

  private establish(socket: net.Socket): void {
    this.logWithIdentity(
      `tunnel: connected to ${this.target.host}:${this.target.port}, starting handshake`
    );

    const h2 = http2.createServer(
      {
        maxSessionMemory: this.deps.opts.maxSessionMemory,
        settings: {
          // TODO why not allow to configure the other h2 options?
          maxConcurrentStreams: this.deps.opts.maxConcurrentStreams,
          initialWindowSize: 1024 * 1024,
          maxFrameSize: 65536,
        },
      },
      (req, res) => this.handleRequest(req, res)
    );

    h2.on("session", (s) => {
      this.logWithIdentity(
        `tunnel: h2 session established to ${targetLabel(this.target)} (localSettings=${formatSettings(
          s.localSettings
        )}, remoteSettings=${formatSettings(s.remoteSettings)})`
      );
      s.on("localSettings", (settings: http2.Settings) =>
        this.logWithIdentity(
          `tunnel: h2 local settings acknowledged by ${targetLabel(this.target)}: ${formatSettings(settings)}`
        )
      );
      s.on("remoteSettings", (settings: http2.Settings) =>
        this.logWithIdentity(
          `tunnel: h2 remote settings from ${targetLabel(this.target)}: ${formatSettings(settings)}`
        )
      );
      // Role-flip complete: the cloud is now our h2 client. connecting →
      // handshaking, arming the timer that fires if the server never opens
      // /_/start-tunnel.
      if (this.state.kind === "connecting") {
        const firstRequestTimer = setTimeout(() => {
          if (
            this.state.kind === "handshaking" &&
            this.state.handshake === undefined
          ) {
            this.settle({
              kind: "retryable",
              reason: "server never initiated /_/start-tunnel",
            });
          }
        }, this.deps.opts.handshakeTimeoutMs);
        firstRequestTimer.unref();
        this.state = {
          kind: "handshaking",
          session: s,
          firstRequestTimer,
          handshake: undefined,
        };
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
        this.settle(
          this.endOutcome("session closed before handshake completed"),
          "session closed"
        )
      );
      s.on("error", (err: Error) =>
        this.settle(
          this.endOutcome(`session error: ${err.message}`),
          `session error: ${err.message}`
        )
      );
    });
    h2.on("sessionError", (err: Error) =>
      this.settle(
        this.endOutcome(`session error: ${err.message}`),
        `session error: ${err.message}`
      )
    );

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
          this.notReady(res);
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
    if (
      this.state.kind === "handshaking" &&
      this.state.handshake !== undefined
    ) {
      const handshake = this.state.handshake;
      void handshake.then(({ ok }) => {
        if (this.closed || res.stream.destroyed) return;
        try {
          if (ok) this.dispatchForwarded(req, res);
          else {
            this.logWithIdentity(
              `tunnel: refused forwarded stream ${res.stream.id ?? "?"} before tunnel handshake completed`
            );
            this.notReady(res);
          }
        } catch {
          // The session may be tearing down under us.
        }
      });
      return;
    }
    // Before /_/start-tunnel was even opened (or already gone) — not a tunnel
    // server speaking the protocol.
    this.logWithIdentity(
      `tunnel: refused forwarded stream ${res.stream.id ?? "?"} before tunnel handshake completed`
    );
    this.notReady(res);
  }

  private notReady(res: http2.Http2ServerResponse): void {
    res.writeHead(503, { [TUNNEL_DRAINING_HEADER]: "true" });
    res.end("tunnel: not ready");
  }

  /** First stream: run the handshake; its outcome opens the gate. */
  private startHandshake(
    req: http2.Http2ServerRequest,
    res: http2.Http2ServerResponse
  ): void {
    if (this.state.kind !== "handshaking") return;
    clearTimeout(this.state.firstRequestTimer);
    this.state.handshake = performHandshake(
      req,
      res,
      {
        authToken: this.authToken,
        environmentId: this.deps.opts.environmentId,
        tunnelName: this.deps.opts.tunnelName,
        tunnelWorkerId: this.deps.opts.tunnelWorkerId,
        tunnelConnectionId: this.connectionId,
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
        const watchdog = this.startWatchdog(session);
        // If our own shutdown began while we were handshaking, open straight
        // into a client drain so this connection refuses work from the start.
        this.state = this.deps.isShuttingDown()
          ? { kind: "draining", session, openedAt, trigger: "client", watchdog }
          : { kind: "serving", session, openedAt, watchdog };
        this.logWithIdentity(
          `tunnel: established (name=${outcome.info.tunnelName}, proxy=${outcome.info.proxyUrl})`
        );
        this.deps.onEstablished(outcome.info, this.identity);
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
    if (!this.deps.isStartupReady()) {
      this.logWithIdentity(
        `tunnel: refused forwarded stream ${res.stream.id ?? "?"} before startup readiness gate completed`
      );
      this.notReady(res);
      return;
    }
    if (clientDraining || this.deps.isShuttingDown()) {
      this.logWithIdentity(
        `tunnel: refused forwarded stream ${res.stream.id ?? "?"} during client drain`
      );
      res.writeHead(503, { [TUNNEL_DRAINING_HEADER]: "true" });
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
    const streamId = res.stream.id ?? "?";
    res.stream.once("error", (err: Error) =>
      this.logWithIdentity(
        `tunnel: forwarded stream ${streamId} ${req.method ?? "?"} ${
          req.url ?? "?"
        } failed: ${err.message}`
      )
    );
    try {
      this.deps.sdkHandler(req, res);
    } catch (err) {
      this.logWithIdentity(
        `tunnel: SDK handler threw for forwarded stream ${streamId} ${
          req.method ?? "?"
        } ${req.url ?? "?"}: ${err instanceof Error ? err.message : String(err)}`
      );
      throw err;
    }
  }

  // ---- drain ----

  private handleDrainRequest(res: http2.Http2ServerResponse): void {
    res.writeHead(200);
    res.end();
    this.logWithIdentity(
      `tunnel: received server drain notification from ${targetLabel(this.target)}`
    );
    if (!this.deps.opts.supportsDrain) {
      // Not advertised, so unexpected — acknowledge and let the server
      // close on us; the slot's redial loop re-establishes.
      this.logWithIdentity(
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
    const { session, openedAt, watchdog } = this.state;
    this.logWithIdentity(
      "tunnel: server drain notification accepted — opening a replacement connection"
    );
    watchdog.stop(); // the registry owns the session now; stop pinging it
    this.deregister();
    this.deps.draining.add(session, this.socket!, this.deps.opts.drainGraceMs);
    this.state = {
      kind: "draining",
      session,
      openedAt,
      trigger: "server",
      watchdog,
    };
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
          watchdog: s.watchdog,
        };
        this.sendClientDrainGoaway(s.session);
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

  async finishClientDrain(opts: { force: boolean }): Promise<void> {
    const s = this.state;
    if (s.kind !== "draining" || s.trigger !== "client") return;
    if (opts.force) {
      this.settle(
        { kind: "served", uptimeMs: this.uptimeMs() },
        "client drain grace expired"
      );
      return;
    }
    await this.closeSessionGracefully(s.session);
  }

  // ---- liveness ----

  private startWatchdog(session: http2.Http2Session): Watchdog {
    const watchdog = new Watchdog(session, this.deps.opts, () => {
      this.logWithIdentity("tunnel: pings missed — reconnecting");
      this.settle(
        { kind: "served", uptimeMs: this.uptimeMs() },
        "ping watchdog missed too many acknowledgements"
      );
    });
    watchdog.start();
    return watchdog;
  }
}
