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

// Option validation and TLS construction. Pure — no I/O.

import type * as tls from "node:tls";
import type { ConnectTunnelOptions, TunnelTlsOptions } from "./types.js";

export interface ResolvedOptions {
  region?: string;
  tunnelServers?: string[];
  environmentId: string;
  authToken: string;
  signingPublicKey: string;
  tunnelName: string;
  bidirectional: boolean;
  supportsDrain: boolean;
  drainGraceMs: number;
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

function requireNonEmpty(value: string | undefined, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`tunnel: ${name} is required`);
  }
  return value;
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

/** Validate user options and apply defaults. Throws on misconfiguration. */
export function resolveOptions(options: ConnectTunnelOptions): ResolvedOptions {
  const hasRegion = options.region !== undefined && options.region !== "";
  const hasServers =
    options.tunnelServers !== undefined && options.tunnelServers.length > 0;
  if (hasRegion === hasServers) {
    throw new Error(
      "tunnel: specify exactly one of `region` or `tunnelServers`"
    );
  }
  if (hasRegion && !/^[a-z0-9-]+$/.test(options.region!)) {
    throw new Error(`tunnel: invalid region ${JSON.stringify(options.region)}`);
  }

  const environmentId = requireNonEmpty(options.environmentId, "environmentId");
  if (!/^env_[A-Za-z0-9_-]+$/.test(environmentId)) {
    throw new Error(
      "tunnel: environmentId must be `env_` followed by alphanumerics (e.g. env_201k0yd4...)"
    );
  }
  const authToken = requireNonEmpty(options.authToken, "authToken");
  // Both values travel as HTTP header values in the handshake. Node silently
  // strips header-illegal characters, which would surface as a baffling
  // `unauthorized` from the server — reject them loudly here instead.
  if (!/^[\x21-\x7e]+$/.test(authToken)) {
    throw new Error(
      "tunnel: authToken contains characters that cannot travel in an HTTP header (whitespace or non-printable)"
    );
  }
  const signingPublicKey = requireNonEmpty(
    options.signingPublicKey,
    "signingPublicKey"
  );
  if (!signingPublicKey.startsWith("publickeyv1_")) {
    throw new Error(
      "tunnel: signingPublicKey must be a request-identity public key (publickeyv1_...)"
    );
  }
  const tunnelName = requireNonEmpty(options.tunnelName, "tunnelName");
  if (!/^[A-Za-z0-9._-]+$/.test(tunnelName)) {
    throw new Error(
      `tunnel: invalid tunnelName ${JSON.stringify(tunnelName)} — use letters, digits, '.', '_' or '-'`
    );
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

  return {
    region: hasRegion ? options.region : undefined,
    tunnelServers: hasServers ? options.tunnelServers : undefined,
    environmentId,
    authToken,
    signingPublicKey,
    tunnelName,
    bidirectional: options.bidirectional ?? true,
    supportsDrain: options.supportsDrain ?? true,
    drainGraceMs: positive(options.drainGraceMs, 120_000, "drainGraceMs"),
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
      options.reconnectInitialMs,
      10,
      "reconnectInitialMs"
    ),
    reconnectMaxMs: positive(options.reconnectMaxMs, 120_000, "reconnectMaxMs"),
    reconnectFactor: positive(options.reconnectFactor, 2, "reconnectFactor"),
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
    logger: options.logger ?? (() => {}),
  };
}

/**
 * Build the `tls.connect` options for a tunnel target, or `undefined` for a
 * plaintext connection.
 *
 * Deliberately sets NO `ALPNProtocols`: the tunnel endpoint clears its ALPN
 * list ("tunnel is not normal h2") and both sides speak HTTP/2 with prior
 * knowledge after the TLS handshake. Offering `h2` here would at best be
 * ignored — and the rest of the package depends on the no-ALPN shape (see
 * `bridge.ts`). This is the opposite of a normal h2 client; do not "fix" it.
 */
export function buildTlsConnectOptions(
  tlsOption: boolean | TunnelTlsOptions,
  servername: string
): tls.ConnectionOptions | undefined {
  if (tlsOption === false) return undefined;
  const base: tls.ConnectionOptions = { servername };
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
