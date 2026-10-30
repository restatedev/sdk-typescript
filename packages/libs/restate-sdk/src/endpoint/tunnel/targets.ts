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

type DiagnosticLogger = (message: string) => void;

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
 * - `srvName` (region-derived or given directly): a DNS SRV lookup, each
 *   record expanded to ALL of its addresses (priority asc, weight desc).
 *
 * Error taxonomy (mirrors the Rust resolver): a NEGATIVE answer for an SRV
 * target (the name genuinely has no address — ENOTFOUND/ENODATA) removes
 * that target, and an all-negative answer yields an EMPTY list (the
 * supervisor then reconciles everything away, like Rust's empty set). A
 * TRANSPORT error (EAI_AGAIN, timeouts, SERVFAIL) THROWS instead — the
 * supervisor must keep the existing connections serving and retry, not
 * tear down healthy slots over a resolver blip.
 */
export async function resolveTargets(spec: {
  srvName?: string;
  tunnelServers?: string[];
  logger?: DiagnosticLogger;
}): Promise<Target[]> {
  const log: DiagnosticLogger = spec.logger ?? (() => {});
  if (spec.tunnelServers !== undefined) {
    const targets = spec.tunnelServers.map(parseServerAddress);
    if (targets.length === 0) {
      throw new Error("tunnel: tunnelServers is empty");
    }
    log(
      `tunnel: using configured tunnel target(s): ${targets.map(targetKey).join(", ")}`
    );
    return targets;
  }
  const srvName = spec.srvName!;
  log(`tunnel: resolving tunnel targets from SRV ${srvName}`);
  const records = await dns.promises.resolveSrv(srvName);
  records.sort((a, b) => a.priority - b.priority || b.weight - a.weight);
  log(
    `tunnel: SRV ${srvName} returned ${records.length} record(s): ${
      records.map((r) => `${r.name}:${r.port}`).join(", ") || "<none>"
    }`
  );
  // Expand each SRV target to its addresses: the tunnel connects to EVERY
  // resolved address (one connection per IP), exactly like the Rust client,
  // which flat-maps SRV targets through A/AAAA lookups into per-IP URIs.
  // Lookups run concurrently (Rust uses FuturesUnordered) so one slow
  // resolver doesn't serialize the rest. SNI / certificate verification
  // uses the SRV QUERY name (the cloud's cert covers the SRV name, not
  // per-node hostnames) — mirroring the Rust FixedServerNameResolver.
  const lookups = await Promise.allSettled(
    records.map((r) => dns.promises.lookup(r.name, { all: true }))
  );
  const targets: Target[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < records.length; i++) {
    const r = records[i]!;
    const result = lookups[i]!;
    if (result.status === "rejected") {
      const code = (result.reason as NodeJS.ErrnoException | undefined)?.code;
      if (code === "ENOTFOUND" || code === "ENODATA") {
        log(`tunnel: SRV target ${r.name}:${r.port} has no address (${code})`);
        continue; // negative answer: this SRV target genuinely has no address
      }
      // Transport error — fail the whole resolution so the supervisor
      // keeps existing slots and retries.
      log(
        `tunnel: address lookup for SRV target ${r.name}:${r.port} failed: ${formatError(result.reason)}`
      );
      throw result.reason;
    }
    for (const a of result.value) {
      const key = `${a.address}:${r.port}`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({ host: a.address, port: r.port, servername: srvName });
    }
  }
  log(
    `tunnel: SRV ${srvName} expanded to ${targets.length} target(s): ${
      targets.map(targetKey).join(", ") || "<none>"
    }`
  );
  return targets;
}

/** Stable identity of a target — the unit of one tunnel connection. */
export function targetKey(t: Target): string {
  return `${t.host}:${t.port}`;
}
