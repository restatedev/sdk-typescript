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
//   supervisor.ts — the slot supervisor (one connection per resolved server)
//   handshake.ts  — the /_/start-tunnel credentials/trailers exchange
//   forwarded.ts  — the /<scheme>/<host>/<port> destination-prefix strip
//   targets.ts    — server discovery (SRV per-IP expansion / explicit list)
//   draining.ts   — server-drain handover ownership
//   backoff.ts    — jittered exponential reconnect policy
//
// This module is the thin assembler: it builds the shared registries and the
// per-connection dependencies, hands slot management to the {@link Supervisor},
// and owns the public TunnelConnection handle and its lifecycle (`close` /
// `shutdown` / signal wiring). The cross-cutting mechanisms live in their own
// units — `Supervisor` (slots), `InflightTracker` (drain accounting),
// `DrainingRegistry` (server-drain sessions), `Deferred` (readiness) — so the
// engine holds only lifecycle flags + the public-handle state.

import type * as net from "node:net";
import { createEndpointHandler } from "@restatedev/restate-sdk";

import type { ConnectTunnelOptions, TunnelConnection } from "./types.js";
import { resolveOptions } from "./options.js";
import type { HandshakeInfo } from "./handshake.js";
import {
  type ConnectionDeps,
  type DrainableConnection,
} from "./connection.js";
import { DrainingRegistry } from "./draining.js";
import { Supervisor } from "./supervisor.js";
import { Deferred } from "./util.js";

/**
 * Counts forwarded invocations in flight and lets a graceful shutdown wait for
 * them to finish. Spans both actively-served and server-drained (detached)
 * sessions, since every dispatch increments and every stream close decrements
 * regardless of which session it belongs to.
 */
class InflightTracker {
  private count = 0;
  private notifyDrained: (() => void) | undefined;

  get inFlight(): number {
    return this.count;
  }

  started(): void {
    this.count++;
  }

  ended(): void {
    this.count = Math.max(0, this.count - 1);
    if (this.count === 0 && this.notifyDrained !== undefined) {
      const notify = this.notifyDrained;
      this.notifyDrained = undefined;
      notify();
    }
  }

  /** Resolve once nothing is in flight, or after `graceMs` — whichever first.
   * Only one shutdown runs at a time, so a single waiter suffices. */
  whenDrained(graceMs: number): Promise<void> {
    return new Promise((resolve) => {
      if (this.count === 0) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        this.notifyDrained = undefined;
        resolve();
      }, graceMs);
      timer.unref();
      this.notifyDrained = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }
}

/**
 * Connect this deployment to a Restate Cloud tunnel and serve `services`
 * over it. Returns immediately; connection management runs in the
 * background until `close()`/`shutdown()` (or the `signal`) stops it. See
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

  // ---- shared registries + lifecycle state ----

  const activeSockets = new Set<net.Socket>();
  const activeConnections = new Set<DrainableConnection>();
  const draining = new DrainingRegistry();
  const inflight = new InflightTracker();

  // `shuttingDown` makes every connection refuse new invocations with the
  // drain sentinel (so the cloud deselects us). `stopped`/`toreDown` guard the
  // handle methods against re-entry.
  let stopped = false;
  let toreDown = false;
  let shuttingDown = false;
  let connectionCount = 0;
  let lastInfo: HandshakeInfo | undefined;

  // Resolves on the first successful handshake; rejects on a fatal stop or if
  // the tunnel closes before ever connecting. The catch keeps a never-awaited
  // rejection from surfacing as unhandled.
  const ready = new Deferred<void>();
  void ready.promise.catch(() => {});

  // Anchor the event loop: between a session closing and the next redial timer
  // there may be no pending I/O, and a bare awaited promise does not keep Node
  // alive.
  const keepAlive = setInterval(() => {}, 0x7fffffff);

  const connectionDeps: ConnectionDeps = {
    opts,
    sdkHandler,
    draining,
    activeSockets,
    activeConnections,
    onEstablished: (info) => {
      connectionCount++;
      lastInfo = info;
      ready.resolve();
    },
    isShuttingDown: () => shuttingDown,
    inflightStarted: () => inflight.started(),
    inflightEnded: () => inflight.ended(),
  };

  const supervisor = new Supervisor(
    opts,
    connectionDeps,
    { onFatal: (err) => ready.reject(err) }, // E1 surfaces on ready/error
    log
  );

  // Resolves when the supervisor has fully wound down; then do the one-shot
  // cleanup and settle `ready` for anyone still awaiting it.
  const done = supervisor.done.then(() => {
    draining.destroyAll();
    clearInterval(keepAlive);
    ready.reject(
      supervisor.fatalError ??
        new Error("tunnel: closed before the first handshake")
    );
  });

  // ---- lifecycle ----

  // Abrupt teardown, shared by close() and a grace-expired shutdown(). Idempotent.
  const teardown = (): void => {
    if (toreDown) return;
    toreDown = true;
    supervisor.abortAll();
    for (const socket of activeSockets) socket.destroy();
    activeSockets.clear();
    draining.destroyAll();
    clearInterval(keepAlive);
  };

  const close = async (): Promise<void> => {
    stopped = true;
    teardown();
    await done;
  };

  const shutdown = async ({
    graceMs,
  }: { graceMs?: number } = {}): Promise<void> => {
    if (stopped || toreDown) {
      // Already closing/closed (or a shutdown is already in progress): nothing
      // left to drain gracefully — just await teardown.
      await done;
      return;
    }
    stopped = true;
    // From here every connection refuses new invocations with the drain
    // sentinel, so the cloud stops routing new work to this process.
    shuttingDown = true;
    // Stop dialing/resolving new connections (existing ones keep serving).
    supervisor.stopResolving();
    // Move every live connection into an explicit client-drain: serving ones
    // refuse new invocations and finish in-flight in place; not-yet-serving
    // ones abort. Snapshot first — beginClientDrain may settle a connection,
    // which removes it from the set.
    for (const c of [...activeConnections]) c.beginClientDrain();
    log(
      `tunnel: graceful shutdown — refusing new invocations, draining ${inflight.inFlight} in-flight`
    );
    await inflight.whenDrained(graceMs ?? opts.drainGraceMs);
    // In-flight drained (or grace elapsed): tear the now-idle connections down.
    teardown();
    await done;
  };

  if (options.signal?.aborted) {
    // An already-aborted signal means "don't run" — stop before dialing.
    void close();
  } else {
    options.signal?.addEventListener("abort", () => void close(), {
      once: true,
    });
  }

  // Opt-in: handle process signals ourselves — graceful drain, then exit.
  if (opts.gracefulShutdown !== undefined) {
    const { signals, graceMs } = opts.gracefulShutdown;
    for (const signal of signals) {
      process.once(signal, () => {
        log(`tunnel: received ${signal} — shutting down gracefully`);
        void shutdown({ graceMs }).finally(() => process.exit(0));
      });
    }
  }

  // ---- the public handle ----

  return {
    close,
    shutdown,
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
      return supervisor.fatalError;
    },
    ready: ready.promise,
  };
}
