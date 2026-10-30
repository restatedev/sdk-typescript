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
 * Reconnect backoff policy. Between reconnect attempts the engine waits a
 * jittered exponential delay: it starts at {@link initialInterval}, grows by
 * {@link exponentiationFactor} per failed attempt, is capped at
 * {@link maxInterval}, and resets after a connection stays up long enough to be
 * considered stable. Intervals accept a {@link Duration} or a number of
 * milliseconds.
 *
 * The field names mirror the invocation and ingress retry policies. Note the
 * reconnect loop is unbounded — there is no `maxAttempts`; it redials forever
 * until a connection succeeds or the connection is shut down.
 */
export interface ReconnectRetryPolicy {
  /** Initial delay. A number is interpreted as milliseconds. Default 10 milliseconds. */
  initialInterval?: Duration | number;
  /** Maximum delay. A number is interpreted as milliseconds. Default 120_000 milliseconds. */
  maxInterval?: Duration | number;
  /**
   * Exponentiation factor applied to the delay after each failed attempt.
   * Default 2.
   */
  exponentiationFactor?: number;
}

/**
 * Connection tuning for {@link connect}: reconnect and drain behaviour, HTTP/2 limits, TLS.
 * Every option has a default that fits Restate Cloud; most deployments set
 * none of them.
 */
export interface ConnectTuningOptions {
  /**
   * How often DNS SRV discovery re-resolves the server set. Default 30_000.
   * (The Rust client re-resolves on DNS TTL expiry; Node does not expose
   * record TTLs, so a fixed interval approximates it.) Ignored with explicit
   * server addresses.
   */
  resolveIntervalMs?: number;
  /**
   * Protocol mode for the SDK handler. Default `true` (`BIDI_STREAM`) —
   * the connection is always HTTP/2, so full-duplex streaming is available.
   */
  bidirectional?: boolean;
  /**
   * Optional one-shot startup readiness gate. Without this option the engine
   * dials immediately. When supplied, it waits for this promise or callback
   * to complete before dialing any server, so Restate Cloud cannot select
   * this worker until the local handler is ready. If the gate rejects,
   * throws, or does not complete within {@link startupReadyTimeoutMs}, the
   * connection stops and `ready` rejects.
   *
   * This is the startup counterpart to {@link supportsClientDrain}: startup
   * gates traffic until the handler is ready; shutdown drain removes the
   * connection from selection before the handler stops.
   */
  startupReady?: PromiseLike<void> | (() => void | PromiseLike<void>);
  /**
   * Deadline for {@link startupReady}. Default 120_000. Only used when
   * `startupReady` is supplied; a stuck startup gate is treated as fatal so a
   * broken worker is visible instead of silently absent from the fleet.
   */
  startupReadyTimeoutMs?: number;
  /**
   * Advertise graceful-drain support (`supports-drain: true`) in the
   * handshake. Default `true`. When Restate Cloud rolls a server it asks
   * drain-capable connections to drain: the engine then immediately opens a
   * replacement connection while the old one keeps serving its in-flight
   * invocations (bounded by {@link drainGraceMs}) — zero dropped requests
   * across cloud rollovers. With `false`, the cloud simply closes the
   * connection and in-flight invocations are retried by the Restate runtime
   * after the redial.
   */
  supportsDrain?: boolean;
  /**
   * How long a draining connection may keep serving its in-flight
   * invocations before being torn down. Default 120_000.
   */
  drainGraceMs?: number;
  /**
   * Advertise client-initiated graceful drain (`supports-client-drain: true`)
   * in the handshake. Default `true`. When enabled, `shutdown()` (or the
   * default {@link gracefulShutdown} signal handler) proactively sends
   * HTTP/2 GOAWAY and refuses any raced streams with a drain sentinel, so
   * Restate Cloud stops routing new work to this process while its in-flight
   * invocations finish — the basis for zero-dropped-invocation rollouts.
   */
  supportsClientDrain?: boolean;
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
 * Options for {@link connect}: the endpoint options (`services`, …) plus the
 * two inputs that identify the deployment — the {@link name} (or
 * `RESTATE_CONNECT_NAME`) and the {@link key} (or `RESTATE_CONNECT_KEY`) — and,
 * rarely needed, the {@link connection} tuning. Request identity validation is
 * always on: `identityKeys` defaults to the key's `signing-key`.
 */
export interface ConnectOptions extends EndpointOptions {
  /**
   * The deployment name, e.g. `"greeter-v1"`: the identity you register
   * (`restate deployments register connect://<name>`). Restate Cloud routes by
   * `<environment>/<name>` and load-balances across every connection under
   * it, so replicas of the same deployment share one name and distinct
   * deployments each have their own. Letters, digits, `.`, `_` and `-`.
   *
   * Falls back to `RESTATE_CONNECT_NAME`. Required: an unnamed deployment is
   * a mistake, there is no inferred default.
   */
  name?: string;
  /**
   * The connect key from the Cloud UI (Development → Configure SDK):
   * `restate://<api key>@<environment id>.env.<region domain>/?signing-key=…`.
   * One string carrying the credential and every coordinate. Falls back to
   * `RESTATE_CONNECT_KEY`. Usually left unset so the secret stays out of the
   * code.
   */
  key?: string;
  /**
   * How the connection is made and kept: server discovery overrides,
   * reconnect and drain behaviour, HTTP/2 limits, TLS. Every option has a
   * default that fits Restate Cloud; most deployments leave this out.
   */
  connection?: ConnectionOptions;
}

/**
 * The {@link ConnectOptions.connection} tuning: the shared
 * {@link ConnectTuningOptions} plus server discovery and the worker id.
 */
export interface ConnectionOptions extends ConnectTuningOptions {
  /**
   * A DNS SRV name to discover the servers to connect to, instead of the one
   * derived from the key (`tunnel.<region domain>`, or its `tunnel-srv`
   * parameter). For environments with a custom domain; the Cloud UI puts it
   * in the key when needed, so this is rarely set by hand. Servers are
   * discovered via a DNS SRV lookup expanded to every resolved address — the
   * engine holds **one connection per resolved server** and re-resolves every
   * {@link ConnectTuningOptions.resolveIntervalMs}, starting connections to
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
  /** The deployment name, as configured and confirmed by the server. */
  readonly name: string;
  /**
   * The deployment URL to register (`restate deployments register <url>`):
   * the proxy base Restate Cloud announced in the handshake, always on port
   * 9080, plus `/http/in-process/9080/` — a constant tail, since an
   * in-process deployment is never dialed and routing is by {@link name}.
   * `undefined` until the first successful handshake. Registering by name
   * (`connect://<name>`) needs none of this.
   */
  readonly deploymentUrl: string | undefined;
  /** Stop reconnecting, close the current connections, and wait for teardown. */
  close(): Promise<void>;
  /**
   * Gracefully drain, then stop. Proactively sends HTTP/2 GOAWAY so Restate
   * Cloud stops opening new streams, refuses any raced streams with a drain
   * sentinel, lets in-flight invocations finish — bounded by `graceMs`
   * (default {@link ConnectTuningOptions.drainGraceMs}) — and then closes the
   * session gracefully. If the grace elapses first, the session/socket are
   * force-closed. The default {@link ConnectTuningOptions.gracefulShutdown}
   * handler wires this to `SIGTERM`; {@link close} is the abrupt alternative.
   * Requires {@link ConnectTuningOptions.supportsClientDrain} (the default)
   * to have been advertised; otherwise it degrades to an abrupt {@link close}.
   */
  shutdown(opts?: { graceMs?: number }): Promise<void>;
  /** Number of successful handshakes since {@link connect} was called. */
  readonly connectionCount: number;
  /**
   * Set when the connection stopped on a non-retryable failure (e.g. the
   * server rejected the key or the name). Once set, the engine no longer
   * reconnects.
   */
  readonly error: Error | undefined;
}

/**
 * Everything the engine needs, fully resolved: `connect()` and
 * `connectTunnel()` build this from their options and the environment.
 * Internal.
 */
export interface EngineOptions extends ConnectTuningOptions {
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
  /** Raw diagnostic hook replacing the SDK logger (the legacy option). */
  diagnosticLogger?: (message: string) => void;
}

/**
 * What the engine returns: the public {@link Connection} plus what the last
 * handshake announced. `connect()` projects it onto {@link Connection}.
 * Internal.
 */
export interface EngineHandle extends Connection {
  /** The name confirmed by the server in the most recent handshake. */
  readonly tunnelName: string | undefined;
  /** The proxy base URL announced in the most recent handshake. */
  readonly proxyUrl: string | undefined;
  /** The server URL announced in the most recent handshake. */
  readonly tunnelUrl: string | undefined;
}
