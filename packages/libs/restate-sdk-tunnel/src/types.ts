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

// Public types for @restatedev/restate-sdk-tunnel.

import type { EndpointOptions } from "@restatedev/restate-sdk";

/**
 * The services to expose over the tunnel — the same shape `restate.serve`
 * and `createEndpointHandler` accept (services, virtual objects, workflows).
 */
export type Services = EndpointOptions["services"];

/**
 * TLS options for the outbound tunnel connection.
 *
 * Note: unlike a regular HTTP/2 client, the tunnel deliberately negotiates
 * NO ALPN protocol ("tunnel is not normal h2" — the server clears its ALPN
 * list); both sides speak HTTP/2 with prior knowledge after the TLS
 * handshake. There is therefore no ALPN field here, and the package never
 * sets one.
 */
export interface TunnelTlsOptions {
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
   * dialed (for region/SRV discovery, the SRV target hostname).
   */
  servername?: string;
  /** Verify the server certificate. Default true. */
  rejectUnauthorized?: boolean;
}

/**
 * Options for {@link connectTunnel}.
 *
 * The identity and discovery options fall back to `RESTATE_INPROC_*`
 * environment variables when not given (option > environment > throw):
 * `tunnelName` ← `RESTATE_INPROC_TUNNEL_NAME`, `environmentId` ←
 * `RESTATE_INPROC_ENVIRONMENT_ID`, `region` ← `RESTATE_INPROC_CLOUD_REGION`,
 * `signingPublicKey` ← `RESTATE_INPROC_SIGNING_PUBLIC_KEY`, and `authToken`
 * ← the file named by `RESTATE_INPROC_AUTH_TOKEN_FILE` (re-read on every
 * reconnect, so rotations are picked up). The
 * [restate-operator](https://github.com/restatedev/restate-operator)
 * injects the first four into the pods of a `tunnelMode: in-process`
 * RestateDeployment and registers the matching URL — there,
 * `connectTunnel({ services })` plus a token-file Secret mount (named by
 * `RESTATE_INPROC_AUTH_TOKEN_FILE`) is a complete configuration.
 */
export interface ConnectTunnelOptions {
  /**
   * Restate Cloud region (e.g. `"us"`, `"eu"`). Tunnel servers are
   * discovered via a DNS SRV lookup of `tunnel.<region>.restate.cloud`,
   * expanded to every resolved address — the engine holds **one tunnel
   * connection per resolved tunnel server** (like the standalone client),
   * and re-resolves every {@link resolveIntervalMs}, starting connections
   * to servers that appear and tearing down connections to servers that
   * vanish.
   *
   * Exactly one of `region`, `tunnelServersSrv` or `tunnelServers` must be
   * set. When none is, `region` falls back to the
   * `RESTATE_INPROC_CLOUD_REGION` environment variable.
   */
  region?: string;
  /**
   * A DNS SRV name to discover tunnel servers from, for environments whose
   * SRV name doesn't follow the `tunnel.<region>.restate.cloud` template
   * (the standalone client's `RESTATE_TUNNEL_SERVERS_SRV`). Same expansion
   * and reconciliation semantics as `region`.
   *
   * Exactly one of `region`, `tunnelServersSrv` or `tunnelServers` must be
   * set.
   */
  tunnelServersSrv?: string;
  /**
   * Explicit tunnel server addresses, instead of region-based discovery.
   * Each entry is either `"host:port"` (TLS governed by the `tls` option)
   * or a URL `"https://host:port"` / `"http://host:port"` (scheme selects
   * TLS/plaintext for that server). The engine holds one tunnel connection
   * per entry; the set is fixed (no re-resolution).
   *
   * Exactly one of `region`, `tunnelServersSrv` or `tunnelServers` must be
   * set.
   */
  tunnelServers?: string[];
  /**
   * How often region-based discovery re-resolves the tunnel-server set.
   * Default 30_000. (The Rust client re-resolves on DNS TTL expiry; Node
   * does not expose record TTLs, so a fixed interval approximates it.)
   * Ignored with explicit `tunnelServers`.
   */
  resolveIntervalMs?: number;
  /**
   * The Restate Cloud environment ID to tunnel to, including the `env_`
   * prefix (e.g. `"env_201k0yd4rz8yftmd4awh1bajg4v"`).
   *
   * Falls back to the `RESTATE_INPROC_ENVIRONMENT_ID` environment variable.
   */
  environmentId?: string;
  /**
   * A Restate Cloud API key with the `Full` role (`key_...`), or a user
   * JWT. Presented as `authorization: Bearer <token>` during the tunnel
   * handshake; validated server-side.
   *
   * Falls back to the contents of the file named by the
   * `RESTATE_INPROC_AUTH_TOKEN_FILE` environment variable — the right shape
   * for a mounted Kubernetes Secret: the file is re-read on every reconnect,
   * so a rotated token is picked up without a restart.
   */
  authToken?: string;
  /**
   * The environment's request-identity public key
   * (`publickeyv1_<base58>`). Passed to the SDK's request-identity
   * verification so every forwarded request is checked to genuinely come
   * from your environment. Shown by Restate Cloud for your environment.
   *
   * Falls back to the `RESTATE_INPROC_SIGNING_PUBLIC_KEY` environment
   * variable.
   */
  signingPublicKey?: string;
  /**
   * The deployment's identity: the rendezvous key both ends use to route.
   * The tunnel server keys connections by `<environment>/<tunnelName>` and
   * load-balances each proxied invocation across every connection
   * registered under that key — so replicas of the *same* deployment must
   * share one `tunnelName`, and distinct deployments must each have their
   * own. It appears in the deployment registration URL, so it should be
   * stable across restarts (e.g. `"greeter-v1"`).
   *
   * Falls back to the `RESTATE_INPROC_TUNNEL_NAME` environment variable
   * (the restate-operator injects a per-revision name there).
   */
  tunnelName?: string;
  /** The services to serve over the tunnel. */
  services: Services;
  /**
   * Protocol mode for the SDK handler. Default `true` (`BIDI_STREAM`) —
   * the tunnel is always HTTP/2, so full-duplex streaming is available.
   */
  bidirectional?: boolean;
  /**
   * Advertise graceful-drain support (`supports-drain: true`) in the
   * handshake. Default `true`. When Restate Cloud rolls a tunnel node it
   * sends `/_/drain-tunnel` to drain-capable connections: the engine then
   * immediately opens a replacement connection while the old one keeps
   * serving its in-flight invocations (bounded by {@link drainGraceMs}) —
   * zero dropped requests across cloud rollovers. With `false`, the cloud
   * simply closes the connection and in-flight invocations are retried by
   * the Restate runtime after the redial.
   */
  supportsDrain?: boolean;
  /**
   * How long a draining connection may keep serving its in-flight
   * invocations before being torn down. Default 120_000 (mirrors the
   * standalone tunnel client).
   */
  drainGraceMs?: number;
  /**
   * Advertise client-initiated graceful drain (`supports-client-drain: true`)
   * in the handshake. Default `true`. When enabled, {@link
   * TunnelConnection.shutdown} (or the opt-in {@link gracefulShutdown} signal
   * handler) refuses new invocations with a drain sentinel so Restate Cloud
   * stops routing new work to this process while its in-flight invocations
   * finish — the basis for zero-dropped-invocation rollouts. Specific to this
   * in-process client; the standalone Rust client does not implement it.
   */
  supportsClientDrain?: boolean;
  /**
   * Automatic graceful shutdown on process signals. **On by default**: the
   * engine installs a one-shot handler for each signal (default `SIGTERM`)
   * that calls {@link TunnelConnection.shutdown} and then `process.exit(0)`
   * once draining completes (or the grace elapses) — so an operator-managed
   * deployment gets zero-dropped-invocation rollouts with no wiring. The
   * handlers are removed when the connection closes.
   *
   * Pass `false` to opt out entirely — e.g. to manage signals and process
   * exit yourself and call {@link TunnelConnection.shutdown} by hand. Pass an
   * object to choose the signals and grace, or `true` for the defaults.
   */
  gracefulShutdown?: boolean | { signals?: NodeJS.Signals[]; graceMs?: number };
  /**
   * Reconnect backoff: initial delay in milliseconds. Default 10.
   * The delay grows by `reconnectFactor` per failed attempt (with jitter)
   * up to `reconnectMaxMs`, and resets after a successful handshake.
   */
  reconnectInitialMs?: number;
  /** Reconnect backoff: maximum delay in milliseconds. Default 120_000. */
  reconnectMaxMs?: number;
  /** Reconnect backoff: growth factor. Default 2. */
  reconnectFactor?: number;
  /**
   * Deadline for establishing the TCP connection and completing the TLS
   * handshake. Default 5_000 (mirrors the standalone tunnel client's
   * connect timeout). Without it, a peer that accepts the connection but
   * never completes TLS would stall reconnection indefinitely.
   */
  connectTimeoutMs?: number;
  /**
   * Deadline for the tunnel handshake (the server opening
   * `/_/start-tunnel` and completing it with trailers). Default 5_000,
   * mirroring the tunnel server's own handshake timeout.
   */
  handshakeTimeoutMs?: number;
  /**
   * Liveness watchdog: send an HTTP/2 PING every this many milliseconds.
   * Default 75_000 (the tunnel protocol's keepalive cadence).
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
   * dialed host, and — deliberately — NO ALPN). Pass `false` only for
   * plaintext dev/test setups, or an object for a private CA / mTLS.
   */
  tls?: boolean | TunnelTlsOptions;
  /** Abort to stop reconnecting and close the tunnel (same as `close()`). */
  signal?: AbortSignal;
  /** Diagnostic logger. Default: silent. */
  logger?: (message: string) => void;
}

/**
 * Handle returned by {@link connectTunnel}.
 */
export interface TunnelConnection {
  /** Stop reconnecting, close the current connection, and wait for teardown. */
  close(): Promise<void>;
  /**
   * Gracefully drain, then stop. Stops accepting new invocations (Restate
   * Cloud deselects this process via the drain sentinel), lets in-flight
   * invocations finish — bounded by `graceMs` (default {@link
   * ConnectTunnelOptions.drainGraceMs}) — and then tears down. Resolves once
   * drained or the grace elapsed. Wire this to `SIGTERM` for
   * zero-dropped-invocation rollouts; {@link close} is the abrupt alternative.
   * Requires {@link ConnectTunnelOptions.supportsClientDrain} (the default) to
   * have been advertised; otherwise it degrades to an abrupt {@link close}.
   */
  shutdown(opts?: { graceMs?: number }): Promise<void>;
  /** Number of successful tunnel handshakes since `connectTunnel` was called. */
  readonly connectionCount: number;
  /**
   * The tunnel name confirmed by the server in the most recent successful
   * handshake. `undefined` until the first handshake completes.
   */
  readonly tunnelName: string | undefined;
  /**
   * The public proxy **base** URL for this tunnel
   * (`<proxy-host>/<env-id>/<tunnel-name>`), learned from the most recent
   * successful handshake. The deployment registration URL is this base plus
   * a `/<scheme>/<host>/<port>` destination segment — for an in-process
   * deployment the destination is vestigial, e.g.
   * `${proxyUrl}/http/in-process/9080`. Registering the bare base URL will
   * not route.
   */
  readonly proxyUrl: string | undefined;
  /** The tunnel server URL, learned from the most recent successful handshake. */
  readonly tunnelUrl: string | undefined;
  /**
   * The full deployment registration URL:
   * `<proxyUrl>/http/in-process/9080/` — register this with
   * `restate dep register <url>` (or the UI) once the tunnel is
   * {@link ready}. `undefined` until the first successful handshake.
   *
   * The `/http/in-process/9080/` destination segment is a constant: an
   * in-process tunnel terminates at this very process, so the destination
   * is never dialed and plays no routing role — the deployment's identity
   * is the `tunnelName` earlier in the path.
   *
   * Built from the handshake-advertised proxy URL; on BYOC clusters where
   * Restate reaches the proxy via a cluster-internal address instead,
   * substitute that base and keep the path.
   */
  readonly deploymentUrl: string | undefined;
  /**
   * Set when the tunnel stopped on a non-retryable failure (e.g. the server
   * answered `unauthorized` or `bad-tunnel-name`). Once set, the tunnel no
   * longer reconnects.
   */
  readonly error: Error | undefined;
  /**
   * Resolves when the first tunnel handshake succeeds; rejects if the
   * tunnel stops on a non-retryable failure before ever connecting.
   * Useful for readiness checks; safe to ignore.
   */
  readonly ready: Promise<void>;
}
