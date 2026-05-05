// Channel<T>
// =============================================================================
//
// A single-shot in-memory communication primitive. Cooperative — the
// receiver chooses when to read, by yielding the channel's `receive`
// Future. Composes with select, race, and any other Future-shaped
// primitive.
//
// Semantics:
//
//   send(v)   — yieldable. `yield* ch.send(v)` settles the channel
//               with v. The first send wins; subsequent sends are
//               silently dropped (idempotent).
//   receive   — a Future<T> that resolves with the sent value once
//               send fires. Always the same Future on every access;
//               settles once, stays settled forever, safe to share
//               across multiple selects/races.
//
// `send` returns `Operation<void>` so the only way to fire it is via
// `yield*` from inside a generator body. This keeps channels
// intra-workflow by construction — external code (setTimeout,
// webhooks, cross-handler signals) doesn't have a generator to
// `yield*` from, and should use `ops.awakeable()` instead, which is
// durably journaled.
//
// Implementation: ChannelImpl is a `WaitTarget` (see future.ts). The
// receive Future has `LocalBacking` pointing at this impl. When a
// fiber yields receive, parkOnAwaitAny / parkOnLeaf treats it the
// same as a routine-backed target — register a waiter, fire on
// settle. `lib.race` never sees the channel; production's
// RestatePromise.race is not involved.

import type { Settled, Waiter } from "./scheduler-types.js";
import { type Future, makeFuture, type WaitTarget } from "./future.js";
import { type Operation, gen } from "./operation.js";

class ChannelImpl<T> implements WaitTarget<T> {
  private state: { kind: "pending" } | { kind: "settled"; value: T } = {
    kind: "pending",
  };
  private waiters: Waiter[] = [];

  // Synchronous side-effect; only invoked from inside the gen body
  // returned by Channel.send (which itself is only iterable via
  // yield* inside a fiber).
  fire(value: T): void {
    if (this.state.kind === "settled") return;
    this.state = { kind: "settled", value };
    const ws = this.waiters;
    this.waiters = [];
    const settled: Settled = { ok: true, v: value };
    for (const w of ws) w(settled);
  }

  isDone(): boolean {
    return this.state.kind === "settled";
  }

  settledValue(): Settled {
    if (this.state.kind !== "settled") {
      throw new Error("ChannelImpl.settledValue called on a pending channel");
    }
    return { ok: true, v: this.state.value };
  }

  awaitCompletion(waiter: Waiter): Settled | null {
    if (this.state.kind === "settled") {
      return { ok: true, v: this.state.value };
    }
    this.waiters.push(waiter);
    return null;
  }
}

export interface Channel<T> {
  /**
   * Yieldable. Use as `yield* ch.send(value)` from within a gen body.
   * The first call settles the channel; subsequent calls are silently
   * dropped (idempotent).
   *
   * Return value is `Operation<void>` rather than `void` so the only
   * way to fire send is via `yield*` inside a fiber — which enforces
   * the channel-is-intra-workflow contract at the type level.
   */
  send(value: T): Operation<void>;
  readonly receive: Future<T>;
}

export function makeChannel<T>(): Channel<T> {
  const impl = new ChannelImpl<T>();
  return {
    send: (v: T): Operation<void> =>
      // The generator body is intentionally yield-less: send's purpose
      // is a synchronous side effect that runs only when iterated via
      // `yield*`. The Operation wrapper exists for the type-level
      // enforcement, not because there's anything to suspend on.
      gen<void>(function* () {
        impl.fire(v);
      }),
    receive: makeFuture<T>({ kind: "local", target: impl }),
  };
}
