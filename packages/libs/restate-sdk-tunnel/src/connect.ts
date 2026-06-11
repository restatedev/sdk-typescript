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

// The tunnel engine.
// =============================================================================
//
// connectTunnel() serves a Restate SDK deployment over OUTBOUND connections
// to Restate Cloud's tunnel servers — no inbound listener. The pieces:
//
//   connection.ts — one dial → role-flip → handshake → serve cycle
//   handshake.ts  — the /_/start-tunnel credentials/trailers exchange
//   forwarded.ts  — the /<scheme>/<host>/<port> destination-prefix strip
//   targets.ts    — server discovery (SRV per-IP expansion / explicit list)
//   draining.ts   — graceful-drain handover ownership
//   backoff.ts    — jittered exponential reconnect policy
//
// This module owns the engine: the SLOT SUPERVISOR (multi-homing — like the
// Rust client, one connection per resolved tunnel server, reconciled as DNS
// changes; K is not configurable, it IS the resolved set), per-slot
// reconnect loops with fatal-vs-retryable classification, and the public
// TunnelConnection handle.
//
// Engine invariants:
//
//   E1. A FATAL outcome (unauthorized / bad-tunnel-name / name mismatch) on
//       ANY slot stops the WHOLE tunnel — the credentials are shared, so
//       every other slot would hit the same wall. Fatal wakes the
//       supervisor, aborts every slot, tears down draining sessions, and
//       surfaces on `error`/`ready` instead of retry-looping the auth path.
//   E2. Backoff resets only after a connection held for
//       MIN_UPTIME_FOR_BACKOFF_RESET_MS; a drain only skips the backoff
//       sleep under the same guard (drain-spam must compound like any
//       handshake-ok-then-die cycle).
//   E3. Teardown is prompt everywhere: close()/fatal abort in-flight dials
//       via per-slot signals, race the (un-abortable) DNS work instead of
//       awaiting it, and never wait out a sleep or a drain grace window.

import type * as net from "node:net";
import { createEndpointHandler } from "@restatedev/restate-sdk";

import type { ConnectTunnelOptions, TunnelConnection } from "./types.js";
import { resolveOptions } from "./options.js";
import { resolveTargets, targetKey, type Target } from "./targets.js";
import type { HandshakeInfo } from "./handshake.js";
import { runConnection, type ConnectionDeps } from "./connection.js";
import { DrainingRegistry } from "./draining.js";
import { Backoff, MIN_UPTIME_FOR_BACKOFF_RESET_MS } from "./backoff.js";
import { delay, raceAbortable } from "./util.js";

/** A running per-server connection loop. */
interface Slot {
  ctl: AbortController;
  done: Promise<void>;
}

/**
 * Connect this deployment to a Restate Cloud tunnel and serve `services`
 * over it. Returns immediately; connection management runs in the
 * background until `close()` (or the `signal`) stops it. See
 * {@link TunnelConnection.ready} to await the first successful handshake.
 */
export function connectTunnel(options: ConnectTunnelOptions): TunnelConnection {
  const opts = resolveOptions(options);
  const log = opts.logger;

  // Built once, shared across connections and streams (it is stateless per
  // call). identityKeys delegates per-request JWT verification to the SDK —
  // it checks `aud` against the post-strip `req.url` pathname.
  const sdkHandler = createEndpointHandler({
    services: options.services,
    bidirectional: opts.bidirectional,
    identityKeys: [opts.signingPublicKey],
  });

  // ---- engine state ----

  let stopped = false;
  let fatalError: Error | undefined;
  let connectionCount = 0;
  let lastInfo: HandshakeInfo | undefined;
  const activeSockets = new Set<net.Socket>();
  const draining = new DrainingRegistry();
  const slots = new Map<string, Slot>();

  // Aborted by close(); cascades into every slot.
  const stopController = new AbortController();
  // Wakes the supervisor out of its sleeps promptly on close() AND on a
  // fatal (so teardown doesn't wait out resolveIntervalMs) — E3.
  const supervisorWake = new AbortController();
  stopController.signal.addEventListener(
    "abort",
    () => supervisorWake.abort(),
    { once: true }
  );

  let readyResolve!: () => void;
  let readyReject!: (err: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  // A caller may never await `ready`; don't turn a fatal handshake into an
  // unhandled rejection.
  ready.catch(() => {});

  // Anchor the event loop: between a session closing and the next redial
  // timer there may be no pending I/O, and a bare awaited promise does not
  // keep Node alive.
  const keepAlive = setInterval(() => {}, 0x7fffffff);

  const connectionDeps: ConnectionDeps = {
    opts,
    sdkHandler,
    draining,
    activeSockets,
    onEstablished: (info) => {
      connectionCount++;
      lastInfo = info;
      readyResolve();
    },
  };

  // ---- slots: one tunnel connection per resolved server ----

  const stopAllSlots = () => {
    for (const slot of slots.values()) slot.ctl.abort();
    supervisorWake.abort();
  };

  /** The per-server loop: dial → serve → classify outcome → backoff → redial. */
  const runSlot = async (target: Target, ctl: AbortController) => {
    const backoff = new Backoff(
      opts.reconnectInitialMs,
      opts.reconnectFactor,
      opts.reconnectMaxMs
    );

    while (!stopped && !ctl.signal.aborted && fatalError === undefined) {
      const outcome = await runConnection(target, ctl.signal, connectionDeps);
      if (stopped || ctl.signal.aborted) break;
      if (outcome.kind === "fatal") {
        // E1: shared credentials — stop everything.
        fatalError = new Error(`tunnel: ${outcome.reason}`);
        log(`tunnel: FATAL — ${outcome.reason}; stopping all connections`);
        readyReject(fatalError);
        stopAllSlots();
        break;
      }
      if (outcome.kind === "served" || outcome.kind === "drained") {
        // E2: only a connection that actually held resets the backoff.
        const heldLongEnough =
          outcome.uptimeMs >= MIN_UPTIME_FOR_BACKOFF_RESET_MS;
        if (heldLongEnough) backoff.reset();
        if (outcome.kind === "drained" && heldLongEnough) {
          // A stable connection was asked to rotate and the server is
          // holding the old one open for us — replace it NOW.
          log("tunnel: draining — reconnecting immediately");
          continue;
        }
        log(
          outcome.kind === "drained"
            ? "tunnel: drained shortly after connecting — reconnecting with backoff"
            : "tunnel: connection ended — reconnecting"
        );
      } else {
        log(`tunnel: ${outcome.reason} — reconnecting`);
      }
      await delay(backoff.next(), ctl.signal);
    }
  };

  const startSlot = (key: string, target: Target) => {
    const ctl = new AbortController();
    // Chain to the global stop so close() cascades; self-detaching.
    stopController.signal.addEventListener("abort", () => ctl.abort(), {
      once: true,
      signal: ctl.signal,
    });
    const slot: Slot = { ctl, done: Promise.resolve() };
    slot.done = runSlot(target, ctl).finally(() => {
      // Guarded: this key may have vanished and re-appeared, in which case
      // a NEWER slot owns it — don't delete someone else's registration.
      if (slots.get(key) === slot) slots.delete(key);
    });
    slots.set(key, slot);
  };

  // ---- the supervisor: resolve the server set, reconcile slots, repeat ----
  //
  // For SRV discovery the set is re-resolved every resolveIntervalMs; an
  // explicit tunnelServers set is fixed and resolved once (like the Rust
  // client's fixed_uri_stream).

  const loopDone = (async () => {
    while (!stopped && fatalError === undefined) {
      let targets: Target[];
      try {
        // E3: race the (un-abortable) DNS work against the wake signal so
        // close()/fatal don't block on a slow resolver — a late result is
        // discarded by the stopped/fatal check below.
        const resolution = resolveTargets(opts);
        resolution.catch(() => {}); // a late rejection must not be unhandled
        const raced = await raceAbortable(resolution, supervisorWake.signal);
        if (raced === null) break; // woken: stopped or fatal
        targets = raced;
      } catch (err) {
        // Keep whatever slots exist serving; retry the resolution later
        // (the Rust client does the same on SRV failures).
        log(
          `tunnel: target resolution failed: ${err instanceof Error ? err.message : String(err)} — retrying`
        );
        await delay(
          Math.min(5_000, opts.resolveIntervalMs),
          supervisorWake.signal
        );
        continue;
      }
      if (stopped || fatalError !== undefined) break;

      const desired = new Map(targets.map((t) => [targetKey(t), t] as const));
      for (const [key, target] of desired) {
        if (!slots.has(key)) {
          log(`tunnel: starting connection to ${key}`);
          startSlot(key, target);
        }
      }
      for (const [key, slot] of slots) {
        if (!desired.has(key)) {
          log(`tunnel: ${key} no longer resolves — tearing down`);
          slot.ctl.abort();
        }
      }

      if (opts.srvName === undefined) break; // explicit servers: fixed set
      await delay(opts.resolveIntervalMs, supervisorWake.signal);
    }
    // Slots still in the map are live; evicted ones have already settled.
    // No slot can start after the supervisor loop exits.
    await Promise.all([...slots.values()].map((s) => s.done));
    draining.destroyAll();
    clearInterval(keepAlive);
    // If the tunnel never established (closed or stopped before the first
    // ok handshake), settle `ready` so awaiting callers don't hang. No-op
    // if it already resolved/rejected.
    readyReject(
      fatalError ?? new Error("tunnel: closed before the first handshake")
    );
  })();

  // ---- the public handle ----

  const close = async (): Promise<void> => {
    if (!stopped) {
      stopped = true;
      stopController.abort();
      stopAllSlots();
      for (const socket of activeSockets) socket.destroy();
      activeSockets.clear();
      draining.destroyAll();
      clearInterval(keepAlive);
    }
    await loopDone;
  };

  if (options.signal?.aborted) {
    // An already-aborted signal means "don't run" — stop before dialing.
    void close();
  } else {
    options.signal?.addEventListener("abort", () => void close(), {
      once: true,
    });
  }

  return {
    close,
    get connectionCount() {
      return connectionCount;
    },
    get tunnelName() {
      return lastInfo?.tunnelName;
    },
    get proxyUrl() {
      return lastInfo?.proxyUrl;
    },
    get tunnelUrl() {
      return lastInfo?.tunnelUrl;
    },
    get deploymentUrl() {
      if (lastInfo === undefined) return undefined;
      // Public clusters may advertise the proxy without a port; the proxy
      // listens on 9080. The destination (`/http/in-process/9080/`) is a
      // constant — an in-process tunnel is never dialed, so the server
      // routes purely by the tunnelName earlier in the path.
      try {
        const proxy = new URL(lastInfo.proxyUrl);
        if (proxy.port === "") proxy.port = "9080";
        const base = proxy.toString().replace(/\/$/, "");
        return `${base}/http/in-process/9080/`;
      } catch {
        return `${lastInfo.proxyUrl}/http/in-process/9080/`;
      }
    },
    get error() {
      return fatalError;
    },
    ready,
  };
}
