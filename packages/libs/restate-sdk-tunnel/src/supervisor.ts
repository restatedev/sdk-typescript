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

// The slot supervisor.
// =============================================================================
//
// Multi-homing — one tunnel connection per resolved tunnel server (like the
// Rust client; the slot set IS the resolved set, it is not configurable). The
// supervisor resolves the server set, reconciles the slot map against it
// (starting connections to servers that appear, tearing down ones that
// vanish), and re-resolves every `resolveIntervalMs` for SRV discovery. Each
// slot runs its own reconnect loop with fatal-vs-retryable classification.
//
// Invariants:
//   E1. A FATAL outcome (unauthorized / bad-tunnel-name / name mismatch) on
//       ANY slot stops the WHOLE tunnel — the credentials are shared, so every
//       other slot would hit the same wall. It aborts every slot and reports
//       via `hooks.onFatal`; the engine surfaces it on `error`/`ready`.
//   E2. Backoff resets only after a connection held for
//       MIN_UPTIME_FOR_BACKOFF_RESET_MS; a drain only skips the backoff sleep
//       under the same guard (drain-spam must compound).
//   E3. Teardown is prompt: `abortAll()` aborts in-flight dials via per-slot
//       signals and wakes the resolve loop out of any sleep; the (un-abortable)
//       DNS work is raced against the wake signal, never awaited.

import type { ResolvedOptions } from "./options.js";
import { resolveTargets, targetKey, type Target } from "./targets.js";
import { runConnection, type ConnectionDeps } from "./connection.js";
import { Backoff, MIN_UPTIME_FOR_BACKOFF_RESET_MS } from "./backoff.js";
import { delay, raceAbortable } from "./util.js";

/** A running per-server connection loop. */
interface Slot {
  ctl: AbortController;
  done: Promise<void>;
}

function formatTargetList(keys: string[]): string {
  return keys.length === 0 ? "<none>" : keys.join(", ");
}

export interface SupervisorHooks {
  /** A slot hit a non-retryable failure; the whole tunnel must stop (E1). */
  onFatal: (err: Error) => void;
}

export class Supervisor {
  private readonly slots = new Map<string, Slot>();
  /** Aborting this cascades to every slot (each slot chains its ctl to it). */
  private readonly stopSignal = new AbortController();
  /** Wakes the resolve loop out of a sleep / DNS race (E3). */
  private readonly wake = new AbortController();
  private stopping = false;
  private fatal: Error | undefined;
  private lastResolvedKeys: string[] | undefined;

  /** Resolves when the resolve loop has exited AND every slot has settled. */
  readonly done: Promise<void>;

  constructor(
    private readonly opts: ResolvedOptions,
    private readonly deps: ConnectionDeps,
    private readonly hooks: SupervisorHooks,
    private readonly log: (message: string) => void
  ) {
    this.stopSignal.signal.addEventListener("abort", () => this.wake.abort(), {
      once: true,
    });
    this.done = this.supervise();
  }

  get fatalError(): Error | undefined {
    return this.fatal;
  }

  /**
   * Stop starting/resolving new connections; existing slots keep running so
   * their connections can finish draining in place (client-initiated drain).
   */
  stopResolving(): void {
    this.stopping = true;
    this.log("tunnel: supervisor stopping target resolution");
    this.wake.abort();
  }

  /** Abort every slot and the resolve loop (engine teardown). */
  abortAll(): void {
    this.stopping = true;
    this.log("tunnel: supervisor aborting all connections");
    this.stopSignal.abort();
  }

  private startSlot(key: string, target: Target): void {
    const ctl = new AbortController();
    // Chain to the global stop so abortAll() cascades; self-detaching.
    this.stopSignal.signal.addEventListener("abort", () => ctl.abort(), {
      once: true,
      signal: ctl.signal,
    });
    const slot: Slot = { ctl, done: Promise.resolve() };
    slot.done = this.runSlot(target, ctl).finally(() => {
      // Guarded: this key may have vanished and re-appeared, in which case a
      // NEWER slot owns it — don't delete someone else's registration.
      if (this.slots.get(key) === slot) this.slots.delete(key);
    });
    this.slots.set(key, slot);
  }

  private async waitForStartupReady(): Promise<boolean> {
    if (this.opts.startupReady === undefined) return true;
    this.log(
      `tunnel: waiting for startup readiness gate (timeoutMs=${this.opts.startupReadyTimeoutMs})`
    );
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const ready = this.opts.startupReady();
      ready.catch(() => {}); // a late rejection after abort must not be unhandled
      const readyOrTimeout = Promise.race([
        ready,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            reject(
              new Error(
                `startup readiness gate timed out after ${this.opts.startupReadyTimeoutMs}ms`
              )
            );
          }, this.opts.startupReadyTimeoutMs);
        }),
      ]);
      readyOrTimeout.catch(() => {});
      const raced = await raceAbortable(readyOrTimeout, this.wake.signal);
      if (raced === null) return false;
      this.log("tunnel: startup readiness gate passed");
      return true;
    } catch (err) {
      if (this.stopping || this.wake.signal.aborted) return false;
      const reason = err instanceof Error ? err.message : String(err);
      this.fatal = new Error(
        `tunnel: startup readiness gate failed: ${reason}`
      );
      this.log(
        `tunnel: FATAL — startup readiness gate failed: ${reason}; stopping all connections`
      );
      this.hooks.onFatal(this.fatal);
      this.stopSignal.abort();
      return false;
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }

  /** The per-server loop: dial → serve → classify outcome → backoff → redial. */
  private async runSlot(target: Target, ctl: AbortController): Promise<void> {
    const backoff = new Backoff(
      this.opts.reconnectInitialMs,
      this.opts.reconnectFactor,
      this.opts.reconnectMaxMs
    );

    while (!this.stopping && !ctl.signal.aborted && this.fatal === undefined) {
      const outcome = await runConnection(target, ctl.signal, this.deps);
      if (this.stopping || ctl.signal.aborted) break;
      if (outcome.kind === "fatal") {
        // E1: shared credentials — stop everything.
        this.fatal = new Error(`tunnel: ${outcome.reason}`);
        this.log(`tunnel: FATAL — ${outcome.reason}; stopping all connections`);
        this.hooks.onFatal(this.fatal);
        this.stopSignal.abort();
        break;
      }
      if (outcome.kind === "served" || outcome.kind === "drained") {
        // E2: only a connection that actually held resets the backoff.
        const heldLongEnough =
          outcome.uptimeMs >= MIN_UPTIME_FOR_BACKOFF_RESET_MS;
        if (heldLongEnough) backoff.reset();
        if (outcome.kind === "drained" && heldLongEnough) {
          // A stable connection was asked to rotate and the server is holding
          // the old one open for us — replace it NOW.
          this.log("tunnel: draining — reconnecting immediately");
          continue;
        }
        this.log(
          outcome.kind === "drained"
            ? "tunnel: drained shortly after connecting — reconnecting with backoff"
            : "tunnel: connection ended — reconnecting"
        );
      } else {
        this.log(`tunnel: ${outcome.reason} — reconnecting`);
      }
      await delay(backoff.next(), ctl.signal);
    }
  }

  /** Resolve the server set, reconcile slots, repeat. For SRV discovery the
   * set is re-resolved every resolveIntervalMs; an explicit set is fixed. */
  private async supervise(): Promise<void> {
    if (!(await this.waitForStartupReady())) return;
    while (!this.stopping && this.fatal === undefined) {
      let targets: Target[];
      try {
        // E3: race the (un-abortable) DNS work against the wake signal so
        // teardown/fatal don't block on a slow resolver — a late result is
        // discarded by the stopping/fatal check below.
        const resolution = resolveTargets({ ...this.opts, logger: this.log });
        resolution.catch(() => {}); // a late rejection must not be unhandled
        const raced = await raceAbortable(resolution, this.wake.signal);
        if (raced === null) break; // woken: stopping or fatal
        targets = raced;
      } catch (err) {
        // Keep whatever slots exist serving; retry the resolution later
        // (the Rust client does the same on SRV failures).
        this.log(
          `tunnel: target resolution failed: ${err instanceof Error ? err.message : String(err)} — retrying`
        );
        await delay(
          Math.min(5_000, this.opts.resolveIntervalMs),
          this.wake.signal
        );
        continue;
      }
      if (this.stopping || this.fatal !== undefined) break;

      const desired = new Map(targets.map((t) => [targetKey(t), t] as const));
      const desiredKeys = [...desired.keys()].sort();
      if (
        this.lastResolvedKeys === undefined ||
        desiredKeys.length !== this.lastResolvedKeys.length ||
        desiredKeys.some((key, i) => key !== this.lastResolvedKeys![i])
      ) {
        const source =
          this.opts.srvName === undefined
            ? "configured tunnel targets"
            : `SRV ${this.opts.srvName}`;
        this.log(
          `tunnel: target set from ${source}: ${formatTargetList(desiredKeys)}`
        );
        if (this.lastResolvedKeys !== undefined) {
          const previous = new Set(this.lastResolvedKeys);
          const current = new Set(desiredKeys);
          const added = desiredKeys.filter((key) => !previous.has(key));
          const removed = this.lastResolvedKeys.filter(
            (key) => !current.has(key)
          );
          if (added.length > 0) {
            this.log(
              `tunnel: discovered new tunnel target(s): ${formatTargetList(added)}`
            );
          }
          if (removed.length > 0) {
            this.log(
              `tunnel: tunnel target(s) disappeared: ${formatTargetList(removed)}`
            );
          }
        }
        this.lastResolvedKeys = desiredKeys;
      }
      for (const [key, target] of desired) {
        if (!this.slots.has(key)) {
          this.log(`tunnel: starting connection to ${key}`);
          this.startSlot(key, target);
        }
      }
      for (const [key, slot] of this.slots) {
        if (!desired.has(key)) {
          this.log(`tunnel: ${key} no longer resolves — tearing down`);
          slot.ctl.abort();
        }
      }

      if (this.opts.srvName === undefined) break; // explicit servers: fixed set
      await delay(this.opts.resolveIntervalMs, this.wake.signal);
    }
    // Slots still in the map are live; evicted ones have already settled. No
    // slot can start after the loop exits (stopping/fatal both gate startSlot).
    await Promise.all([...this.slots.values()].map((s) => s.done));
  }
}
