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

// Tunnel-server discovery: explicit addresses or region-based DNS SRV.

import * as dns from "node:dns";
import { srvNameForRegion } from "./options.js";

/** A dialable tunnel server. */
export interface Target {
  host: string;
  port: number;
  /**
   * TLS SNI / verification name. For SRV-discovered targets this is the SRV
   * QUERY name (`tunnel.<region>.restate.cloud` — what the cloud's cert
   * covers), regardless of which per-record host is dialed; for explicit
   * addresses it is the configured host.
   */
  servername: string;
  /**
   * Per-target plaintext override: set when an explicit `http://` URL was
   * given. `undefined` means "follow the global `tls` option".
   */
  plaintext?: boolean;
}

/**
 * Parse one explicit tunnel-server address: `"host:port"`, or a URL whose
 * scheme picks TLS (`https`) / plaintext (`http`) for that server.
 * Throws on a malformed address.
 */
export function parseServerAddress(address: string): Target {
  if (address.includes("://")) {
    let url: URL;
    try {
      url = new URL(address);
    } catch {
      throw new Error(
        `tunnel: invalid tunnel server URL ${JSON.stringify(address)}`
      );
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(
        `tunnel: unsupported tunnel server scheme ${JSON.stringify(url.protocol)} (use http or https)`
      );
    }
    if (url.pathname !== "/" || url.search !== "") {
      throw new Error(
        `tunnel: tunnel server URL must not have a path or query: ${JSON.stringify(address)}`
      );
    }
    const port =
      url.port !== "" ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
    return {
      host: url.hostname,
      port,
      servername: url.hostname,
      plaintext: url.protocol === "http:",
    };
  }
  // "host:port" — split on the LAST colon so IPv6-ish hosts survive.
  const idx = address.lastIndexOf(":");
  if (idx <= 0 || idx === address.length - 1) {
    throw new Error(
      `tunnel: invalid tunnel server address ${JSON.stringify(address)} (expected "host:port" or a URL)`
    );
  }
  const host = address.slice(0, idx);
  const port = Number(address.slice(idx + 1));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `tunnel: invalid port in tunnel server address ${JSON.stringify(address)}`
    );
  }
  return { host, port, servername: host };
}

/**
 * Resolve the current set of tunnel servers. Called fresh per connection
 * attempt, so DNS changes are picked up across redials.
 *
 * - Explicit `tunnelServers`: parsed as-is (no DNS here — the dial resolves
 *   the hostname).
 * - `region`: a DNS SRV lookup of `tunnel.<region>.restate.cloud`. Records
 *   are ordered by SRV priority (lowest first), then weight (highest
 *   first); each record's target hostname and port become a dialable
 *   target, with TLS verified against the SRV target name.
 *
 * Throws if nothing resolves.
 */
export async function resolveTargets(spec: {
  region?: string;
  tunnelServers?: string[];
}): Promise<Target[]> {
  if (spec.tunnelServers !== undefined) {
    const targets = spec.tunnelServers.map(parseServerAddress);
    if (targets.length === 0) {
      throw new Error("tunnel: tunnelServers is empty");
    }
    return targets;
  }
  const srvName = srvNameForRegion(spec.region!);
  const records = await dns.promises.resolveSrv(srvName);
  if (records.length === 0) {
    throw new Error(`tunnel: SRV lookup of ${srvName} returned no records`);
  }
  records.sort((a, b) => a.priority - b.priority || b.weight - a.weight);
  // SNI / certificate verification uses the SRV QUERY name (the cloud's
  // cert covers `tunnel.<region>.restate.cloud`), not the per-record target
  // hostname — mirroring the Rust client's FixedServerNameResolver, which
  // pins ServerName to the SRV name for every resolved target.
  return records.map((r) => ({
    host: r.name,
    port: r.port,
    servername: srvName,
  }));
}
