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
// connectTunnel() serves a Restate SDK deployment over OUTBOUND connections to
// Restate Cloud's tunnel servers — no inbound listener. The pieces:
//
//   connection.ts — one dial → role-flip → handshake → serve cycle
//   supervisor.ts — the slot supervisor (one connection per resolved server)
//   handshake.ts  — the /_/start-tunnel credentials/trailers exchange
//   forwarded.ts  — the /<scheme>/<host>/<port> destination-prefix strip
//   targets.ts    — server discovery (SRV per-IP expansion / explicit list)
//   draining.ts   — server-drain handover ownership
//   backoff.ts    — jittered exponential reconnect policy
//
// The engine has three kinds of state, kept deliberately separate:
//
//   * Injected infrastructure — the registries (activeSockets/activeConnections/
//     draining/inflight) that ConnectionDeps hands to every connection. By
//     definition the per-connection layer reads these, so they are created once
//     and injected, not stored in a lifecycle phase.
//   * Observable output — connectionCount / lastInfo / fatalError, which the
//     handle exposes in every phase (including after close()), so they live in
//     one lifetime record rather than a phase.
//   * Lifecycle state — `EngineState`, a disjoint union whose live phases own
//     the supervisor + the event-loop anchor (and, while draining, the in-flight
//     drain promise). Each transition narrows the state and destructures what it
//     needs, so no function reaches for the live machinery in the wrong phase
//     (and `closed` provably has none).

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

/** The engine's observable output — readable from the handle in every phase. */
interface Output {
  connectionCount: number;
  lastInfo: HandshakeInfo | undefined;
  fatalError: Error | undefined;
}

/** The live machinery, owned by the running/draining phases and gone in closed. */
interface Active {
  readonly supervisor: Supervisor;
  /** Anchors the event loop while live (a bare awaited promise won't keep Node
   * alive between a session closing and the next redial timer). */
  readonly keepAlive: NodeJS.Timeout;
}

/** The engine lifecycle as one disjoint state; live phases carry `Active`. */
type EngineState =
  | { readonly kind: "running"; readonly active: Active }
  | {
      readonly kind: "draining";
      readonly active: Active;
      readonly completed: Promise<void>;
    }
  | { readonly kind: "closed" };

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

  // Injected infrastructure: the per-connection layer reads these via deps.
  const activeSockets = new Set<net.Socket>();
  const activeConnections = new Set<DrainableConnection>();
  const draining = new DrainingRegistry();
  const inflight = new InflightTracker();

  // Observable output (valid in every phase, including after close).
  const output: Output = {
    connectionCount: 0,
    lastInfo: undefined,
    fatalError: undefined,
  };

  // Resolves on the first successful handshake; rejects on a fatal stop or if
  // the tunnel closes before connecting. The catch keeps a never-awaited
  // rejection from surfacing as unhandled.
  const ready = new Deferred<void>();
  void ready.promise.catch(() => {});

  // Assigned synchronously below once the live machinery exists; the deps
  // closures only read it at runtime, long after.
  let state: EngineState;

  // Opt-in process-signal handlers, removed on teardown so a closed connection
  // can never later intercept a signal and exit the host process.
  const signalHandlers: Array<[NodeJS.Signals, () => void]> = [];

  const connectionDeps: ConnectionDeps = {
    opts,
    sdkHandler,
    draining,
    activeSockets,
    activeConnections,
    onEstablished: (info) => {
      if (state.kind === "closed") return;
      output.connectionCount++;
      output.lastInfo = info;
      ready.resolve();
    },
    isShuttingDown: () => state.kind === "draining",
    inflightStarted: () => inflight.started(),
    inflightEnded: () => inflight.ended(),
  };

  const supervisor = new Supervisor(
    opts,
    connectionDeps,
    {
      onFatal: (err) => {
        output.fatalError = err; // E1 surfaces on ready/error
        ready.reject(err);
      },
    },
    log
  );

  const keepAlive = setInterval(() => {}, 0x7fffffff);

  state = { kind: "running", active: { supervisor, keepAlive } };

  // ---- transitions ----

  /** Abrupt teardown; idempotent. Destructures the live machinery from the
   * state, so it can only run while running/draining. */
  const teardown = (): void => {
    if (state.kind === "closed") return;
    const { supervisor, keepAlive } = state.active;
    state = { kind: "closed" };
    for (const [signal, handler] of signalHandlers) {
      process.removeListener(signal, handler);
    }
    signalHandlers.length = 0;
    supervisor.abortAll();
    for (const socket of activeSockets) socket.destroy();
    activeSockets.clear();
    draining.destroyAll();
    clearInterval(keepAlive);
  };

  // Resolves when the supervisor has fully wound down; then tear down (covers a
  // fatal that stopped us with no close()/shutdown() call) and settle `ready`.
  const done = supervisor.done.then(() => {
    teardown();
    ready.reject(
      output.fatalError ??
        new Error("tunnel: closed before the first handshake")
    );
  });

  const drainGracefully = async (
    active: Active,
    graceMs: number
  ): Promise<void> => {
    const { supervisor } = active;
    // Stop dialing/resolving new connections (existing ones keep serving) and
    // move every live connection into a client-drain: serving ones refuse new
    // invocations and finish in-flight in place; not-yet-serving ones abort.
    // Snapshot — beginClientDrain may settle a connection, removing it.
    supervisor.stopResolving();
    for (const c of [...activeConnections]) c.beginClientDrain();
    log(
      `tunnel: graceful shutdown — refusing new invocations, draining ${inflight.inFlight} in-flight`
    );
    await inflight.whenDrained(graceMs);
    // In-flight drained (or grace elapsed): tear the now-idle connections down.
    teardown();
    await done;
  };

  const close = async (): Promise<void> => {
    teardown();
    await done;
  };

  const shutdown = ({ graceMs }: { graceMs?: number } = {}): Promise<void> => {
    // Without the advertised capability the server ignores our drain sentinel,
    // so a graceful drain can't work (refused requests just keep getting
    // routed back) — fall back to an abrupt close, as documented.
    if (!opts.supportsClientDrain) return close();
    // Coalesce: a drain already in progress, or already closed.
    if (state.kind === "draining") return state.completed;
    if (state.kind === "closed") return done;
    // Start the drain and record its promise on the state before the first
    // await, so every connection sees isShuttingDown() for the whole drain.
    // (drainGracefully runs synchronously up to inflight.whenDrained, so no new
    // invocation can interleave before `state` is set.)
    const { active } = state;
    const completed = drainGracefully(active, graceMs ?? opts.drainGraceMs);
    state = { kind: "draining", active, completed };
    return completed;
  };

  // Install process-signal handlers (graceful shutdown is on by default; see
  // ConnectTunnelOptions.gracefulShutdown). Registered BEFORE the
  // already-aborted-signal handling below, so that path's synchronous close()
  // tears them down via teardown() rather than leaving a live handler on a
  // connection that is already closed.
  if (opts.gracefulShutdown !== undefined) {
    const { signals, graceMs } = opts.gracefulShutdown;
    for (const signal of signals) {
      const handler = () => {
        log(`tunnel: received ${signal} — shutting down gracefully`);
        void shutdown({ graceMs }).finally(() => process.exit(0));
      };
      signalHandlers.push([signal, handler]);
      process.once(signal, handler);
    }
  }

  if (options.signal?.aborted) {
    // An already-aborted signal means "don't run" — stop before dialing.
    void close();
  } else {
    options.signal?.addEventListener("abort", () => void close(), {
      once: true,
    });
  }

  // ---- the public handle (reads the observable output) ----

  return {
    close,
    shutdown,
    get connectionCount() {
      return output.connectionCount;
    },
    get tunnelName() {
      return output.lastInfo?.tunnelName;
    },
    get proxyUrl() {
      return output.lastInfo?.proxyUrl;
    },
    get tunnelUrl() {
      return output.lastInfo?.tunnelUrl;
    },
    get deploymentUrl() {
      const lastInfo = output.lastInfo;
      if (lastInfo === undefined) return undefined;
      // Public clusters may advertise the proxy without a port; the proxy
      // listens on 9080. The destination (`/http/in-process/9080/`) is a
      // constant — an in-process tunnel is never dialed, so the server routes
      // purely by the tunnelName earlier in the path.
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
      return output.fatalError;
    },
    ready: ready.promise,
  };
}
