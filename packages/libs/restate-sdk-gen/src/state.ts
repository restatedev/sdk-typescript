// State<TState>
// =============================================================================
//
// Wrapper around Restate's KeyValueStore — the per-key state attached
// to a virtual object or workflow invocation. Available via
// `ops.state()` (read-write) or `ops.sharedState()` (read-only) from
// within `execute()`.
//
// Read-only vs read-write is a real distinction:
//   - ObjectContext / WorkflowContext expose the full KeyValueStore
//     (get + keys + set + clear + clearAll).
//   - ObjectSharedContext / WorkflowSharedContext expose only the
//     reads. Calling `set` etc. on the underlying context throws at
//     runtime; we surface that at the type level by giving shared
//     handlers a narrower interface.
//
// Both interfaces are generic over `TState extends TypedState`:
//   - Default `UntypedState` keeps the loose `(name: string)` shape
//     and a per-call value type — same as the SDK's untyped mode.
//   - Pass an explicit shape to get keyof-checked names and per-key
//     value types: `ops.state<{count: number; user: User}>()` then
//     `state.get("count")` infers `Future<number | null>`.

import type * as restate from "@restatedev/restate-sdk";
import type { Awaitable } from "./awaitable.js";
import type { Future } from "./future.js";
import type { Scheduler } from "./scheduler.js";

/**
 * Marker types matching the SDK's typed-state convention. Pass a
 * concrete shape (e.g. `{count: number; name: string}`) to enable
 * keyof-checked names; leave the default to keep names as `string`
 * with a per-call value generic.
 */
export type TypedState = Record<string, unknown>;
export type UntypedState = { _: never };

/**
 * Read-only state, for handlers running under an
 * ObjectSharedContext or WorkflowSharedContext.
 */
export interface SharedState<TState extends TypedState = UntypedState> {
  /** Read a state value. Returns null if the key isn't set. */
  get<TValue, TKey extends keyof TState = string>(
    name: TState extends UntypedState ? string : TKey,
    serde?: restate.Serde<TState extends UntypedState ? TValue : TState[TKey]>
  ): Future<(TState extends UntypedState ? TValue : TState[TKey]) | null>;

  /** List all currently-known state keys. */
  keys(): Future<string[]>;
}

/**
 * Read-write state, for handlers running under an ObjectContext or
 * WorkflowContext. Extends SharedState with mutation methods.
 *
 * Writes are synchronous in the SDK — the journal entry is recorded
 * immediately, no yield required — so `set` / `clear` / `clearAll`
 * return `void` rather than `Operation<void>`.
 */
export interface State<
  TState extends TypedState = UntypedState,
> extends SharedState<TState> {
  /** Write a state value. Sync; journal entry recorded immediately. */
  set<TValue, TKey extends keyof TState = string>(
    name: TState extends UntypedState ? string : TKey,
    value: TState extends UntypedState ? TValue : TState[TKey],
    serde?: restate.Serde<TState extends UntypedState ? TValue : TState[TKey]>
  ): void;

  /** Clear a single key. */
  clear<TKey extends keyof TState>(
    name: TState extends UntypedState ? string : TKey
  ): void;

  /** Clear all state for this invocation. */
  clearAll(): void;
}

// Loose type covering every Restate context flavor that exposes any
// state methods. We only call KeyValueStore methods on this; the rest
// of Context is unused here.
type StateContext =
  | restate.ObjectContext
  | restate.ObjectSharedContext
  | restate.WorkflowContext
  | restate.WorkflowSharedContext;

/**
 * Build a `State<TState>` over the given context. The runtime delegates
 * straight to `ctx.get` / `ctx.set` / etc.; the TState generic is purely
 * a TS-level convenience and gets erased at runtime.
 *
 * For shared (read-only) contexts, the returned State has the same
 * runtime shape but the caller should use the `SharedState<TState>`
 * type to drop the write methods. The convenience method
 * `RestateOperations.sharedState()` does this cast.
 */
export function makeState<TState extends TypedState = UntypedState>(
  ctx: StateContext,
  sched: Scheduler,
  adapt: <T>(p: restate.RestatePromise<T>) => Awaitable<T>
): State<TState> {
  // Cast for write methods: the typed shared variants don't have them
  // on the type, but the runtime object does carry them in writable
  // contexts. Calling write() from a shared handler throws naturally.
  const writeCtx = ctx as restate.ObjectContext;

  // Internally we use the loose UntypedState signatures and cast the
  // resulting object to the narrower State<TState>. Runtime is identical;
  // the conditional types only matter at the call site.
  const impl: State<UntypedState> = {
    get<T>(name: string, serde?: restate.Serde<T>): Future<T | null> {
      return sched.makeJournalFuture(
        adapt(
          ctx.get<T>(name, serde) as unknown as restate.RestatePromise<T | null>
        )
      );
    },
    keys(): Future<string[]> {
      return sched.makeJournalFuture(
        adapt(ctx.stateKeys() as unknown as restate.RestatePromise<string[]>)
      );
    },
    set<T>(name: string, value: T, serde?: restate.Serde<T>): void {
      writeCtx.set(name, value, serde);
    },
    clear(name: string): void {
      writeCtx.clear(name);
    },
    clearAll(): void {
      writeCtx.clearAll();
    },
  };
  return impl as unknown as State<TState>;
}
