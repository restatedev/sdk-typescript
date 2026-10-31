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

// Public types of connect(): options, tuning and the connection handle.

import type { Duration } from "@restatedev/restate-sdk-core";
import type { EndpointOptions } from "../types.js";

/**
 * TLS options for the outbound connection.
 *
 * The connection always offers ALPN `h2` and requires TLS peers to negotiate
 * it; omit these options to use the system trust store and SNI for the dialed
 * host. There is no user-facing ALPN option because the protocol requires
 * HTTP/2.
 */
export interface ConnectTlsOptions {
  /**
   * CA certificate(s) (PEM) to trust. Omit to use the system trust store —
   * the right choice for Restate Cloud's public endpoints.
   */
  ca?: string | Buffer | Array<string | Buffer>;
  /** Client certificate (PEM) for mutual TLS. */
  cert?: string | Buffer;
  /** Client key (PEM) for mutual TLS. */
  key?: string | Buffer;
  /**
   * SNI / certificate-verification name. Defaults to the hostname being
   * dialed (for DNS SRV discovery, the SRV target hostname).
   */
  servername?: string;
  /** Verify the server certificate. Default true. */
  rejectUnauthorized?: boolean;
}

/**
 * Reconnect retry policy, the same shape as the invocation and client retry
 * policies: a jittered exponential backoff between attempts, reset after a
 * connection stays up long enough to count as stable. Intervals accept a
 * {@link Duration} or a number of milliseconds.
 *
 * Unlike those policies the reconnect loop is unbounded by default — a
 * deployment keeps trying until Restate Cloud is reachable again — so
 * {@link maxAttempts} and {@link maxDuration} default to `false`. A bound is
 * counted per server (and for DNS discovery itself); reaching it stops the
 * deployment only when no other connection is alive, otherwise that server
 * is dropped until discovery brings it back.
 */
export interface ReconnectRetryPolicy {
  /**
   * Max number of attempts (including the initial) in a row without a stable
   * connection, before giving up. Giving up is a non-retryable stop: the
   * connection's `ready`, `close()` and `shutdown()` reject with the reason.
   *
   * Defaults to `false`: no attempt bound.
   */
  maxAttempts?: number | false;
  /**
   * Max total duration without a stable connection, measured from the first
   * failed attempt, before giving up. If a number is provided, it is
   * interpreted as milliseconds.
   *
   * Defaults to `false`: no duration bound.
   */
  maxDuration?: Duration | number | false;
  /**
   * Initial backoff interval. If a number is provided, it is interpreted as
   * milliseconds. Defaults to `10` milliseconds.
   */
  initialInterval?: Duration | number;
  /**
   * Maximum backoff interval. If a number is provided, it is interpreted as
   * milliseconds. Defaults to `120_000` milliseconds.
   */
  maxInterval?: Duration | number;
  /**
   * Exponentiation factor to use when computing the next retry delay.
   * Defaults to `2`.
   */
  exponentiationFactor?: number;
}

/**
 * Options for {@link connect}.
 *
 * A usual connect setup requires 3 configuration options:
 *
 * * The `services` to expose
 * * The {@link name} (or env `RESTATE_CONNECT_NAME`) of the deployment, used to identify this version of the code.
 * * The {@link key} (or `RESTATE_CONNECT_KEY`) required to connect to Restate Cloud/BYOC
 */
export interface ConnectOptions extends EndpointOptions {
  /**
   * Required: The deployment name, e.g. `"greeter-v1"`: the identity you register
   * (`restate deployments register connect://<name>`). Restate Cloud/BYOC routes by
   * `<environment>/<name>` and load-balances across every connection under
   * it, so replicas of the same deployment share one name and distinct
   * deployments each have their own. Letters, digits, `.`, `_` and `-`.
   *
   * Also configurable via env `RESTATE_CONNECT_NAME`.
   */
  name?: string;
  /**
   * The connect key from the Cloud UI -> Development → Configure SDK.
   *
   * Also configurable via env `RESTATE_CONNECT_KEY`.
   */
  key?: string;
  /**
   * Advanced connection options.
   */
  connection?: ConnectionOptions;
}

/**
 * The {@link ConnectOptions.connection} tuning: server discovery, the worker
 * id, reconnect and drain behaviour, HTTP/2 limits, TLS. Every option has a
 * default that fits Restate Cloud; most deployments set none of them.
 */
export interface ConnectionOptions {
  /**
   * A DNS SRV name to discover the servers to connect to, instead of the one
   * derived from the key (`tunnel.<region domain>`, or its `tunnel-srv`
   * parameter). For environments with a custom domain; the Cloud UI puts it
   * in the key when needed, so this is rarely set by hand. Servers are
   * discovered via a DNS SRV lookup expanded to every resolved address — the
   * engine holds **one connection per resolved server** and re-resolves every
   * {@link resolveIntervalMs}, starting connections to
   * servers that appear and tearing down connections to servers that vanish.
   *
   * At most one of `serversSrv` and `servers` may be set.
   */
  serversSrv?: string;
  /**
   * Explicit server addresses, instead of DNS discovery. Each entry is either
   * `"host:port"` (TLS governed by the `tls` option) or a URL
   * `"https://host:port"` / `"http://host:port"` (scheme selects TLS/plaintext
   * for that server). One connection per entry; the set is fixed (no
   * re-resolution). Private networks and tests.
   *
   * At most one of `serversSrv` and `servers` may be set.
   */
  servers?: string[];
  /**
   * Stable diagnostic identifier for this SDK worker/process. Restate Cloud
   * can include it in routing and failure logs so operators can grep
   * server-side events against SDK-side logs. Defaults to a hostname-based
   * id with a short random suffix that is stable for this process. Advisory
   * only: it is sent in the handshake for diagnostics, not used for
   * authentication.
   */
  workerId?: string;
  /**
   * How often DNS SRV discovery re-resolves the server set. Default 30_000.
   * (The Rust client re-resolves on DNS TTL expiry; Node does not expose
   * record TTLs, so a fixed interval approximates it.) Ignored with explicit
   * server addresses.
   */
  resolveIntervalMs?: number;
  /**
   * How long a draining connection may keep serving its in-flight
   * invocations before being torn down. Default 120_000.
   */
  drainGraceMs?: number;
  /**
   * Automatic graceful shutdown on process signals. **On by default**: the
   * engine installs a one-shot handler for each signal (default `SIGTERM`)
   * that calls `shutdown()`. If multiple connections in the same process
   * register for a signal, the shared process-level handler waits for all of
   * them before calling `process.exit(0)` once draining completes (or the
   * grace elapses) — so an operator-managed deployment gets
   * zero-dropped-invocation rollouts with no wiring. In Kubernetes, set
   * `terminationGracePeriodSeconds` to at least the drain grace plus the
   * handler slack you want to preserve. The handlers are removed when the
   * connection closes.
   *
   * Pass `false` to opt out entirely — e.g. to manage signals and process
   * exit yourself and call `shutdown()` by hand. Pass an object to choose the
   * signals and grace, or `true` for the defaults.
   */
  gracefulShutdown?: boolean | { signals?: NodeJS.Signals[]; graceMs?: number };
  /**
   * Reconnect backoff policy: jittered exponential backoff applied between
   * reconnect attempts (10ms → 120s by default), reset after a stable
   * connection. See {@link ReconnectRetryPolicy}.
   */
  reconnectRetryPolicy?: ReconnectRetryPolicy;
  /**
   * Deadline for establishing the TCP connection and completing the TLS
   * handshake. Default 5_000. Without it, a peer that accepts the connection
   * but never completes TLS would stall reconnection indefinitely.
   */
  connectTimeoutMs?: number;
  /**
   * Deadline for the handshake with Restate Cloud. Default 5_000, mirroring
   * the server's own handshake timeout.
   */
  handshakeTimeoutMs?: number;
  /**
   * Liveness watchdog: send an HTTP/2 PING every this many milliseconds.
   * Default 75_000.
   */
  pingIntervalMs?: number;
  /** Watchdog: how long to wait for a PING ack. Default 10_000. */
  pingTimeoutMs?: number;
  /**
   * Watchdog: consecutive missed PINGs before the connection is declared
   * dead and redialed. Default 2.
   */
  pingMaxMissed?: number;
  /**
   * Maximum concurrent HTTP/2 streams (in-flight invocations) per
   * connection. Default 4096 (Node's default of 100 is far too low for a
   * deployment serving many concurrent invocations).
   */
  maxConcurrentStreams?: number;
  /**
   * Per-connection HTTP/2 flow-control window in bytes. Default 16 MiB
   * (Node's 64 KiB default throttles aggregate throughput).
   */
  connectionWindowSize?: number;
  /**
   * Node http2 per-session memory cap in MiB. Default 256 (Node's 10 MiB
   * default makes the session reject work under load).
   */
  maxSessionMemory?: number;
  /**
   * TLS for the outbound connection. Default `true` (system trust, SNI =
   * dialed host, ALPN `h2`). Pass `false` only for plaintext dev/test setups,
   * or an object for a private CA / mTLS.
   */
  tls?: boolean | ConnectTlsOptions;
  /** Abort to stop reconnecting and close the connection (same as `close()`). */
  signal?: AbortSignal;
}

/**
 * Handle returned by {@link connect}: the outbound connection to Restate
 * Cloud serving your services.
 */
export interface Connection {
  /**
   * Resolves when the first handshake succeeds (the deployment is reachable
   * from Restate Cloud and can be registered); rejects if the connection
   * stops on a non-retryable failure before ever connecting. Useful for
   * readiness checks; safe to ignore.
   */
  readonly ready: Promise<void>;
  /** The deployment name, as configured. */
  readonly name: string;
  /**
   * Stop reconnecting, close the current connections, and wait for teardown.
   * Rejects with the fatal error if the connection had already stopped on a
   * non-retryable failure (e.g. Restate Cloud rejected the key or the name).
   */
  close(): Promise<void>;
  /**
   * Gracefully drain, then stop. Proactively sends HTTP/2 GOAWAY so Restate
   * Cloud stops opening new streams, refuses any raced streams with a drain
   * sentinel, lets in-flight invocations finish — bounded by `graceMs`
   * (default {@link ConnectionOptions.drainGraceMs}) — and then closes the
   * session gracefully. If the grace elapses first, the session/socket are
   * force-closed. The default {@link ConnectionOptions.gracefulShutdown}
   * handler wires this to `SIGTERM`; {@link close} is the abrupt alternative.
   * Rejects like {@link close} if the connection had already stopped on a
   * non-retryable failure.
   */
  shutdown(opts?: { graceMs?: number }): Promise<void>;
}

/**
 * Everything the engine needs, fully resolved: `connect()` builds this from
 * its options and the environment. Internal.
 */
export interface EngineOptions extends Omit<
  ConnectionOptions,
  "serversSrv" | "servers" | "workerId"
> {
  services: EndpointOptions["services"];
  defaultServiceOptions?: EndpointOptions["defaultServiceOptions"];
  logger?: EndpointOptions["logger"];
  journalValueCodecProvider?: EndpointOptions["journalValueCodecProvider"];
  /** Request-identity keys; the key's `signing-key` by default. Never empty. */
  identityKeys: string[];
  /** The deployment name, validated. */
  name: string;
  /** `env_…`, validated. */
  environmentId: string;
  /**
   * Returns the bearer token for the handshake. Called once per connection
   * attempt, so a file-backed token is re-read on every redial and rotations
   * are picked up without a restart. May throw (e.g. the file is briefly
   * unreadable mid-rotation) — callers treat that as a retryable failure.
   */
  authToken: () => string;
  /** How to find the servers: a DNS SRV name, or explicit addresses. */
  discovery: { srvName: string } | { servers: string[] };
  /** Diagnostic worker id; a stable hostname-based default otherwise. */
  workerId?: string;
  /** Raw diagnostic hook replacing the SDK logger (tests). */
  diagnosticLogger?: (message: string) => void;
  /** Called once when the engine stops on a non-retryable failure. */
  onFatal?: (error: Error) => void;
}

/**
 * What the engine returns: the public {@link Connection} plus what the last
 * handshake announced. `connect()` projects it onto {@link Connection}.
 * Internal.
 */
export interface EngineHandle extends Connection {
  /** Number of successful handshakes since the engine started. */
  readonly connectionCount: number;
  /** Set when the engine stopped on a non-retryable failure; it no longer reconnects. */
  readonly error: Error | undefined;
  /**
   * The deployment URL (`<proxy base>:9080/<bare env id>/<name>/http/in-process/9080/`),
   * `undefined` until the first successful handshake. Logged at debug;
   * registration is by name.
   */
  readonly deploymentUrl: string | undefined;
  /** The name confirmed by the server in the most recent handshake. */
  readonly tunnelName: string | undefined;
  /** The proxy base URL announced in the most recent handshake. */
  readonly proxyUrl: string | undefined;
  /** The server URL announced in the most recent handshake. */
  readonly tunnelUrl: string | undefined;
}
