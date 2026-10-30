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

// Engine option validation, defaults and TLS construction.
//
// The identity (name, environment, credential, signing key) arrives here
// already resolved by `connect()` / `connectTunnel()` (see ../connect); this
// module validates the tuning and discovery options and applies defaults.

import * as os from "node:os";
import { randomBytes } from "node:crypto";
import type * as tls from "node:tls";
import {
  millisOrDurationToMillis,
  type Duration,
} from "@restatedev/restate-sdk-core";
import type { ConnectTlsOptions, EngineOptions } from "./types.js";
import { parseServerAddress } from "./targets.js";
import type { LoggerTransport } from "../../logging/logger_transport.js";
import { LogSource } from "../../logging/logger_transport.js";
import { createLogger } from "../../logging/logger.js";
import { defaultLoggerTransport } from "../../logging/console_logger_transport.js";

/** Diagnostic worker id sent in the handshake (advisory). */
export const TUNNEL_WORKER_ID_ENV = "RESTATE_TUNNEL_WORKER_ID";

/** Severity of an engine diagnostic; the default sink is the SDK logger. */
export type DiagnosticLevel = "debug" | "info" | "warn" | "error";
/** Engine-internal diagnostic sink. `level` defaults to `debug`. */
export type DiagnosticLogger = (
  message: string,
  level?: DiagnosticLevel
) => void;

export interface ResolvedOptions {
  /** The SRV name to discover servers from, or undefined with explicit servers. */
  srvName?: string;
  tunnelServers?: string[];
  environmentId: string;
  /** See {@link EngineOptions.authToken}. */
  authToken: () => string;
  identityKeys: string[];
  /** The deployment name every connection presents in its handshake. */
  name: string;
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
  tls: boolean | ConnectTlsOptions;
  logger: DiagnosticLogger;
}

/** An env var set to the empty string is treated as unset. */
function fromEnv(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
}

/**
 * Header values travel verbatim in the handshake. Node silently strips
 * header-illegal characters, which would surface as a baffling `unauthorized`
 * from the server — reject them loudly instead.
 */
export function requireHeaderSafe(value: string, what: string): string {
  if (!/^[\x21-\x7e]+$/.test(value)) {
    throw new Error(
      `${what} contains characters that cannot travel in an HTTP header (whitespace or non-printable)`
    );
  }
  return value;
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

// Stable for the process lifetime. Multiple connect() calls in the same
// process get the same default worker id unless explicitly overridden.
const DEFAULT_TUNNEL_WORKER_ID = makeDefaultTunnelWorkerId();

function resolveTunnelWorkerId(option: string | undefined): string {
  const value =
    option !== undefined && option !== ""
      ? option
      : fromEnv(TUNNEL_WORKER_ID_ENV);
  return requireHeaderSafe(value ?? DEFAULT_TUNNEL_WORKER_ID, "workerId");
}

function resolveStartupReady(
  option: EngineOptions["startupReady"]
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
    throw new Error(`${name} must be a positive number`);
  }
  return value;
}

/** Normalize a `Duration | number` into milliseconds (a number is already ms). */
function toMillis(value: Duration | number | undefined): number | undefined {
  return value === undefined ? undefined : millisOrDurationToMillis(value);
}

/** Validate the engine options and apply defaults. Throws on misconfiguration. */
export function resolveOptions(options: EngineOptions): ResolvedOptions {
  let srvName: string | undefined;
  let tunnelServers: string[] | undefined;
  if ("srvName" in options.discovery) {
    srvName = options.discovery.srvName;
    if (!/^[A-Za-z0-9._-]+$/.test(srvName)) {
      throw new Error(`invalid serversSrv ${JSON.stringify(srvName)}`);
    }
  } else {
    tunnelServers = options.discovery.servers;
    if (tunnelServers.length === 0) {
      throw new Error("servers must not be empty");
    }
    // Parse explicit servers eagerly: a config typo must throw here, like
    // every other misconfiguration (the Rust client parses URIs at startup).
    // Left to the supervisor it would look like a transient resolution
    // failure and retry forever without ever connecting.
    for (const address of tunnelServers) parseServerAddress(address);
  }

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
    srvName,
    tunnelServers,
    environmentId: options.environmentId,
    authToken: options.authToken,
    identityKeys: options.identityKeys,
    name: options.name,
    tunnelWorkerId: resolveTunnelWorkerId(options.workerId),
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
    logger: resolveDiagnosticLogger(options.diagnosticLogger, options.logger),
  };
}

/**
 * Engine diagnostics go through the SDK's {@link LoggerTransport} (the one
 * given in the endpoint options, or the default console transport) at the
 * level each message carries — connection churn at debug, lifecycle at info,
 * reconnects at warn, fatal stops at error. An explicit
 * `diagnosticLogger` (the legacy `tunnelDiagnosticLogger`) intercepts every
 * message instead, regardless of level.
 */
function resolveDiagnosticLogger(
  raw: ((message: string) => void) | undefined,
  transport: LoggerTransport | undefined
): DiagnosticLogger {
  if (raw !== undefined) return (message) => raw(message);
  const rlog = createLogger(
    transport ?? defaultLoggerTransport,
    LogSource.SYSTEM
  );
  return (message, level = "debug") => rlog[level](message);
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
    throw new Error("gracefulShutdown.signals must not be empty");
  }
  return {
    signals,
    graceMs: positive(option.graceMs, drainGraceMs, "gracefulShutdown.graceMs"),
  };
}

/**
 * Build the `tls.connect` options for a target, or `undefined` for a
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
  tlsOption: boolean | ConnectTlsOptions,
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

/** The DNS SRV name for a Restate Cloud region domain (`eu.restate.cloud` → `tunnel.eu.restate.cloud`). */
export function srvNameForRegionDomain(regionDomain: string): string {
  return `tunnel.${regionDomain}`;
}
