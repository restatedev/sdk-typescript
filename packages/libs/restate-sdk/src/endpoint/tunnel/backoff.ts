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

// Reconnect backoff policy.

/**
 * Backoff resets only when a served connection stayed up at least this long
 * (mirrors the Rust client's 5s "opened" guard). Without it, a server that
 * authorizes the handshake but immediately drops the connection would be
 * redialed at the backoff floor forever — a full TLS+h2+auth round trip
 * every ~10ms.
 */
export const MIN_UPTIME_FOR_BACKOFF_RESET_MS = 5_000;

/**
 * Jittered exponential backoff: each `next()` returns the current delay
 * with ±50% jitter and advances the schedule toward `maxMs`; `reset()`
 * returns to the floor. Jitter keeps multi-homed slots from redialing in
 * lockstep after a fleet-wide blip (thundering herd).
 */
export class Backoff {
  private currentMs: number;

  constructor(
    private readonly initialMs: number,
    private readonly factor: number,
    private readonly maxMs: number
  ) {
    this.currentMs = initialMs;
  }

  next(): number {
    const d = this.currentMs;
    this.currentMs = Math.min(this.currentMs * this.factor, this.maxMs);
    return d * (0.5 + Math.random());
  }

  reset(): void {
    this.currentMs = this.initialMs;
  }
}
