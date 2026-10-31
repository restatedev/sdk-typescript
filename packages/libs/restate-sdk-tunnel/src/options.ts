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

// Option validation and TLS construction.

import * as fs from "node:fs";
import * as os from "node:os";
import { randomBytes } from "node:crypto";
import type * as tls from "node:tls";
import type { Duration } from "@restatedev/restate-sdk";
import type { ConnectTunnelOptions, TunnelTlsOptions } from "./types.js";
import { parseServerAddress } from "./targets.js";

// The environment variables options fall back to when not given explicitly
// (option > environment > throw). They form the contract with the
// restate-operator, which injects the first four into the pods of a
// `tunnelMode: in-process` RestateDeployment; AUTH_TOKEN_FILE is reserved
// for the user's own Secret mount — credentials are never injected.
export const TUNNEL_NAME_ENV = "RESTATE_INPROC_TUNNEL_NAME";
export const ENVIRONMENT_ID_ENV = "RESTATE_INPROC_ENVIRONMENT_ID";
export const CLOUD_REGION_ENV = "RESTATE_INPROC_CLOUD_REGION";
export const SIGNING_PUBLIC_KEY_ENV = "RESTATE_INPROC_SIGNING_PUBLIC_KEY";
export const AUTH_TOKEN_FILE_ENV = "RESTATE_INPROC_AUTH_TOKEN_FILE";
export const TUNNEL_WORKER_ID_ENV = "RESTATE_TUNNEL_WORKER_ID";

export interface ResolvedOptions {
  /** The SRV name to discover tunnel servers from (region-derived or given). */
  srvName?: string;
  tunnelServers?: string[];
  environmentId: string;
  /**
   * Returns the bearer token for the handshake. Called once per connection
   * attempt: a file-sourced token (AUTH_TOKEN_FILE_ENV) is re-read on every
   * redial so rotations are picked up without a restart. May throw (e.g.
   * the file is briefly unreadable mid-rotation) — callers treat that as a
   * retryable connection failure.
   */
  authToken: () => string;
  signingPublicKey: string;
  tunnelName: string;
  tunnelWorkerId: string;
  bidirectional: boolean;
  startupReady?: () => Promise<void>;
  startupReadyTimeoutMs: number;
  resolveIntervalMs: number;
  supportsDrain: boolean;
  drainGraceMs: number;
  supportsClientDrain: boolean;
  /** Set when auto signal-handling is opted into; undefined leaves signals alone. */
  gracefulShutdown?: { signals: NodeJS.Signals[]; graceMs: number };
  connectTimeoutMs: number;
  handshakeTimeoutMs: number;
  reconnectInitialMs: number;
  reconnectMaxMs: number;
  reconnectFactor: number;
  pingIntervalMs: number;
  pingTimeoutMs: number;
  pingMaxMissed: number;
  maxConcurrentStreams: number;
  connectionWindowSize: number;
  maxSessionMemory: number;
  tls: boolean | TunnelTlsOptions;
  logger: (message: string) => void;
}

/** An env var set to the empty string is treated as unset. */
function fromEnv(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
}

/** Resolve option > environment > throw. */
function requireConfigured(
  value: string | undefined,
  name: string,
  envName: string
): string {
  const resolved =
    value !== undefined && value !== "" ? value : fromEnv(envName);
  if (resolved === undefined) {
    throw new Error(
      `tunnel: ${name} is required (pass the option or set ${envName})`
    );
  }
  return resolved;
}

/**
 * Both credentials travel as HTTP header values in the handshake. Node
 * silently strips header-illegal characters, which would surface as a
 * baffling `unauthorized` from the server — reject them loudly instead.
 */
function requireHeaderSafe(value: string, what: string): string {
  if (!/^[\x21-\x7e]+$/.test(value)) {
    throw new Error(
      `tunnel: ${what} contains characters that cannot travel in an HTTP header (whitespace or non-printable)`
    );
  }
  return value;
}

function resolveAuthToken(option: string | undefined): () => string {
  if (option !== undefined && option !== "") {
    requireHeaderSafe(option, "authToken");
    return () => option;
  }
  const tokenFile = fromEnv(AUTH_TOKEN_FILE_ENV);
  if (tokenFile === undefined) {
    throw new Error(
      `tunnel: authToken is required (pass the option or set ${AUTH_TOKEN_FILE_ENV})`
    );
  }
  const readToken = () => {
    // Guard before reading: this runs synchronously on the redial path, so a
    // FIFO (blocks forever) or an unbounded device file (reads forever) would
    // freeze the event loop — and with it every other live connection.
    const stat = fs.statSync(tokenFile);
    if (!stat.isFile()) {
      throw new Error(
        `tunnel: auth token file ${tokenFile} is not a regular file`
      );
    }
    if (stat.size > 64 * 1024) {
      throw new Error(
        `tunnel: auth token file ${tokenFile} is implausibly large for a token (${stat.size} bytes)`
      );
    }
    // Trimmed because mounted secrets routinely carry a trailing newline.
    const token = fs.readFileSync(tokenFile, "utf8").trim();
    if (token === "") {
      throw new Error(`tunnel: auth token file ${tokenFile} is empty`);
    }
    return requireHeaderSafe(token, `auth token file ${tokenFile}`);
  };
  // A bad path or token must throw at configuration time like every other
  // misconfiguration, not look like a transient failure mid-redial.
  readToken();
  return readToken;
}

function sanitizeDefaultWorkerIdSegment(value: string): string {
  const sanitized = value
    .replace(/[^A-Za-z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (sanitized === "" ? "worker" : sanitized).slice(0, 96);
}

function makeDefaultTunnelWorkerId(): string {
  const host = fromEnv("HOSTNAME") ?? os.hostname() ?? "worker";
  const suffix = randomBytes(4).toString("hex");
  return `${sanitizeDefaultWorkerIdSegment(host)}-${suffix}`;
}

// Stable for the process lifetime. Multiple connectTunnel() calls in the same
// process get the same default worker id unless explicitly overridden.
const DEFAULT_TUNNEL_WORKER_ID = makeDefaultTunnelWorkerId();

function resolveTunnelWorkerId(option: string | undefined): string {
  const value =
    option !== undefined && option !== ""
      ? option
      : fromEnv(TUNNEL_WORKER_ID_ENV);
  return requireHeaderSafe(value ?? DEFAULT_TUNNEL_WORKER_ID, "tunnelWorkerId");
}

function resolveStartupReady(
  option: ConnectTunnelOptions["startupReady"]
): (() => Promise<void>) | undefined {
  if (option === undefined) return undefined;
  if (typeof option === "function") {
    return async () => {
      await option();
    };
  }
  const ready = Promise.resolve(option);
  ready.catch(() => {});
  return async () => {
    await ready;
  };
}

function positive(
  value: number | undefined,
  fallback: number,
  name: string
): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`tunnel: ${name} must be a positive number`);
  }
  return value;
}

/**
 * Normalize a `Duration | number` into milliseconds (a number is already ms).
 * Inlined rather than importing the SDK's `millisOrDurationToMillis`, which is
 * not part of its public API — this keeps the tunnel package dependency-free.
 */
function toMillis(value: Duration | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") return Math.trunc(value);
  return Math.trunc(
    (value.milliseconds ?? 0) +
      1000 * (value.seconds ?? 0) +
      1000 * 60 * (value.minutes ?? 0) +
      1000 * 60 * 60 * (value.hours ?? 0) +
      1000 * 60 * 60 * 24 * (value.days ?? 0)
  );
}

/**
 * Validate user options and apply defaults. Throws on misconfiguration.
 * Each identity/discovery option falls back to its RESTATE_INPROC_* env var
 * (option > environment > throw), so a pod the restate-operator configured
 * for `tunnelMode: in-process` needs no explicit configuration beyond the
 * auth token.
 */
export function resolveOptions(options: ConnectTunnelOptions): ResolvedOptions {
  const hasSrv =
    options.tunnelServersSrv !== undefined && options.tunnelServersSrv !== "";
  const hasServers =
    options.tunnelServers !== undefined && options.tunnelServers.length > 0;
  // The env var only fills the gap when NO discovery option was given — an
  // explicit tunnelServersSrv/tunnelServers wins over an injected region, and
  // an explicitly-given-but-empty tunnelServers stays a loud config error
  // rather than silently yielding to the environment.
  let region = options.region;
  if (
    (region === undefined || region === "") &&
    !hasSrv &&
    options.tunnelServers === undefined
  ) {
    region = fromEnv(CLOUD_REGION_ENV);
  }
  const hasRegion = region !== undefined && region !== "";
  const discoveryCount =
    Number(hasRegion) + Number(hasSrv) + Number(hasServers);
  if (discoveryCount === 0) {
    throw new Error(
      `tunnel: specify one of \`region\`, \`tunnelServersSrv\` or \`tunnelServers\` (or set ${CLOUD_REGION_ENV})`
    );
  }
  if (discoveryCount > 1) {
    throw new Error(
      "tunnel: specify exactly one of `region`, `tunnelServersSrv` or `tunnelServers`"
    );
  }
  // A region becomes DNS labels in `tunnel.{region}.restate.cloud`, so it may be
  // multi-label (e.g. a BYOC region like "inl4edhpbxasp9yuz1n0yvvkme.byoc") —
  // each label lowercase [a-z0-9-], dot-separated, no empty labels.
  if (hasRegion && !/^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(region!)) {
    throw new Error(`tunnel: invalid region ${JSON.stringify(region)}`);
  }
  if (hasSrv && !/^[A-Za-z0-9._-]+$/.test(options.tunnelServersSrv!)) {
    throw new Error(
      `tunnel: invalid tunnelServersSrv ${JSON.stringify(options.tunnelServersSrv)}`
    );
  }
  // Parse explicit servers eagerly: a config typo must throw here, like
  // every other misconfiguration (the Rust client parses URIs at startup).
  // Left to the supervisor it would look like a transient resolution
  // failure and retry forever without ever connecting.
  if (hasServers) {
    for (const address of options.tunnelServers!) parseServerAddress(address);
  }

  const environmentId = requireConfigured(
    options.environmentId,
    "environmentId",
    ENVIRONMENT_ID_ENV
  );
  if (!/^env_[A-Za-z0-9_-]+$/.test(environmentId)) {
    throw new Error(
      "tunnel: environmentId must be `env_` followed by alphanumerics (e.g. env_201k0yd4...)"
    );
  }
  const authToken = resolveAuthToken(options.authToken);
  const signingPublicKey = requireConfigured(
    options.signingPublicKey,
    "signingPublicKey",
    SIGNING_PUBLIC_KEY_ENV
  );
  if (!signingPublicKey.startsWith("publickeyv1_")) {
    throw new Error(
      "tunnel: signingPublicKey must be a request-identity public key (publickeyv1_...)"
    );
  }
  const tunnelName = requireConfigured(
    options.tunnelName,
    "tunnelName",
    TUNNEL_NAME_ENV
  );
  if (!/^[A-Za-z0-9._-]+$/.test(tunnelName)) {
    throw new Error(
      `tunnel: invalid tunnelName ${JSON.stringify(tunnelName)} — use letters, digits, '.', '_' or '-'`
    );
  }
  const tunnelWorkerId = resolveTunnelWorkerId(options.tunnelWorkerId);
  const pingIntervalMs = positive(
    options.pingIntervalMs,
    75_000,
    "pingIntervalMs"
  );
  const pingTimeoutMs = positive(
    options.pingTimeoutMs,
    10_000,
    "pingTimeoutMs"
  );
  const drainGraceMs = positive(options.drainGraceMs, 120_000, "drainGraceMs");

  return {
    srvName: hasRegion
      ? srvNameForRegion(region!)
      : hasSrv
        ? options.tunnelServersSrv
        : undefined,
    tunnelServers: hasServers ? options.tunnelServers : undefined,
    environmentId,
    authToken,
    signingPublicKey,
    tunnelName,
    tunnelWorkerId,
    bidirectional: options.bidirectional ?? true,
    startupReady: resolveStartupReady(options.startupReady),
    startupReadyTimeoutMs: positive(
      options.startupReadyTimeoutMs,
      120_000,
      "startupReadyTimeoutMs"
    ),
    resolveIntervalMs: positive(
      options.resolveIntervalMs,
      30_000,
      "resolveIntervalMs"
    ),
    supportsDrain: options.supportsDrain ?? true,
    drainGraceMs,
    supportsClientDrain: options.supportsClientDrain ?? true,
    gracefulShutdown: resolveGracefulShutdown(
      options.gracefulShutdown,
      drainGraceMs
    ),
    connectTimeoutMs: positive(
      options.connectTimeoutMs,
      5_000,
      "connectTimeoutMs"
    ),
    handshakeTimeoutMs: positive(
      options.handshakeTimeoutMs,
      5_000,
      "handshakeTimeoutMs"
    ),
    reconnectInitialMs: positive(
      toMillis(options.reconnectRetryPolicy?.initialInterval),
      10,
      "reconnectRetryPolicy.initialInterval"
    ),
    reconnectMaxMs: positive(
      toMillis(options.reconnectRetryPolicy?.maxInterval),
      120_000,
      "reconnectRetryPolicy.maxInterval"
    ),
    reconnectFactor: positive(
      options.reconnectRetryPolicy?.exponentiationFactor,
      2,
      "reconnectRetryPolicy.exponentiationFactor"
    ),
    pingIntervalMs,
    pingTimeoutMs,
    pingMaxMissed: positive(options.pingMaxMissed, 2, "pingMaxMissed"),
    maxConcurrentStreams: positive(
      options.maxConcurrentStreams,
      4096,
      "maxConcurrentStreams"
    ),
    connectionWindowSize: positive(
      options.connectionWindowSize,
      16 * 1024 * 1024,
      "connectionWindowSize"
    ),
    maxSessionMemory: positive(
      options.maxSessionMemory,
      256,
      "maxSessionMemory"
    ),
    tls: options.tls ?? true,
    logger: options.tunnelDiagnosticLogger ?? (() => {}),
  };
}

/** Resolve the opt-in auto signal-handling config (undefined = leave signals alone). */
function resolveGracefulShutdown(
  option:
    | boolean
    | { signals?: NodeJS.Signals[]; graceMs?: number }
    | undefined,
  drainGraceMs: number
): { signals: NodeJS.Signals[]; graceMs: number } | undefined {
  // On by default: only an explicit `false` opts out.
  if (option === false) return undefined;
  if (option === undefined || option === true) {
    return { signals: ["SIGTERM"], graceMs: drainGraceMs };
  }
  const signals = option.signals ?? ["SIGTERM"];
  if (signals.length === 0) {
    throw new Error("tunnel: gracefulShutdown.signals must not be empty");
  }
  return {
    signals,
    graceMs: positive(option.graceMs, drainGraceMs, "gracefulShutdown.graceMs"),
  };
}

/**
 * Build the `tls.connect` options for a tunnel target, or `undefined` for a
 * plaintext connection.
 *
 * Always offers ALPN `["h2"]` — the same offer every Rust tunnel client
 * makes — and the connection layer requires the negotiation to succeed:
 * Node's http2 will only run a server session over a TLS socket whose ALPN
 * negotiated `h2`. Tunnel servers advertise it since the standard-h2
 * control-traffic change; older servers (which cleared their ALPN list)
 * cannot serve this client.
 */
export function buildTlsConnectOptions(
  tlsOption: boolean | TunnelTlsOptions,
  servername: string
): tls.ConnectionOptions | undefined {
  if (tlsOption === false) return undefined;
  const base: tls.ConnectionOptions = { servername, ALPNProtocols: ["h2"] };
  if (tlsOption === true) return base;
  return {
    ...base,
    ...(tlsOption.servername !== undefined && {
      servername: tlsOption.servername,
    }),
    ...(tlsOption.ca !== undefined && { ca: tlsOption.ca }),
    ...(tlsOption.cert !== undefined && { cert: tlsOption.cert }),
    ...(tlsOption.key !== undefined && { key: tlsOption.key }),
    ...(tlsOption.rejectUnauthorized !== undefined && {
      rejectUnauthorized: tlsOption.rejectUnauthorized,
    }),
  };
}

/** The DNS SRV name for region-based tunnel-server discovery. */
export function srvNameForRegion(region: string): string {
  return `tunnel.${region}.restate.cloud`;
}
