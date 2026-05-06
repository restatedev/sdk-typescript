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

// State API
// =============================================================================
//
// Two surfaces:
//
//   1. Per-key typed accessor — `state(config)` / `state<TShape>()`
//      Returns an object whose properties are per-key accessor objects,
//      each with `.get()`, `.set()`, `.clear()`. The return type of `.get()`
//      is baked in at accessor-creation time, so TypeScript evaluates it
//      eagerly rather than deferring a conditional over a free type variable.
//
//   2. Flat untyped functions — `getState / setState / clearState /
//      clearAllState / getAllStateKeys`. Used internally and re-exported
//      from free.ts for call sites that don't need per-key typing (e.g.
//      dynamic key names).
//
// Read-only vs read-write is a runtime distinction (ObjectSharedContext vs
// ObjectContext). The type system does not enforce it here — callers in a
// shared context get the same accessor shape; the SDK throws at runtime if
// they call writes.

import type * as restate from "@restatedev/restate-sdk";
import type { Awaitable } from "./awaitable.js";
import type { Future } from "./future.js";
import type { Scheduler } from "./scheduler.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Marker for a key that is typed but has no default. Use when you want
 * keyof-checked names and per-key value types but the key should return
 * `Future<T | null>` (no default substitution).
 *
 * Create with `typed<T>()` and include in the state config:
 *
 *   state({ count: { default: 0 }, label: typed<string>() })
 *   // count.get() → Future<number>
 *   // label.get() → Future<string | null>
 */
export type TypedNoDefault<T> = { readonly _noDefaultType: T };

/** Create a typed-but-no-default marker for use in a state config. */
export function typed<T>(): TypedNoDefault<T> {
  return {} as TypedNoDefault<T>;
}

/** Per-key configuration passed to state(). */
export type StateKeySpec<T = unknown> = {
  /**
   * Default value (or factory) substituted when the store returns null.
   * Use a factory `() => value` for mutable defaults (e.g. arrays/objects)
   * so each invocation gets a fresh copy.
   */
  default?: T | (() => T);
  /** Custom serde for this key. */
  serde?: restate.Serde<T>;
};

/** Any valid per-key spec: either a StateKeySpec or a TypedNoDefault marker. */
export type AnyKeySpec = StateKeySpec | TypedNoDefault<unknown>;

/** Per-key read-write accessor returned by state(). */
export type StateKeyAccessor<T, HasDefault extends boolean> = {
  /**
   * Read the key. Returns the stored value, or the default if set, or null.
   * When the key has a default, the return type is `Future<T>` (never null).
   */
  get(serde?: restate.Serde<T>): Future<HasDefault extends true ? T : T | null>;
  /** Write the key. Synchronous; journal entry recorded immediately. */
  set(value: T, serde?: restate.Serde<T>): void;
  /** Delete the key. */
  clear(): void;
};

// Extract value type from an AnyKeySpec.
// TypedNoDefault<T> → T; factory default → T; static default → T; serde → T; else unknown.
type SpecValue<S extends AnyKeySpec> =
  S extends TypedNoDefault<infer T>
    ? T
    : S extends { default: (...args: never[]) => infer D }
      ? D
      : S extends { default: infer D }
        ? D
        : S extends { serde: restate.Serde<infer D> }
          ? D
          : unknown;

// Whether a spec carries a runtime default (TypedNoDefault never does).
type SpecHasDefault<S extends AnyKeySpec> =
  S extends TypedNoDefault<unknown>
    ? false
    : S extends { default: unknown }
      ? true
      : false;

/** Typed accessor map produced by state(config). */
export type StateAccessors<TConfig extends Record<string, AnyKeySpec>> = {
  [K in keyof TConfig]: StateKeyAccessor<
    SpecValue<TConfig[K]>,
    SpecHasDefault<TConfig[K]>
  >;
};

/** Accessor map produced by state<TShape>() — all keys nullable. */
export type UntypedStateAccessors<TShape extends Record<string, unknown>> = {
  [K in keyof TShape]: StateKeyAccessor<TShape[K], false>;
};

// ---------------------------------------------------------------------------
// Context type
// ---------------------------------------------------------------------------

type StateContext =
  | restate.ObjectContext
  | restate.ObjectSharedContext
  | restate.WorkflowContext
  | restate.WorkflowSharedContext;

// ---------------------------------------------------------------------------
// Runtime implementation
// ---------------------------------------------------------------------------

/**
 * Build one per-key accessor. `rawDefault` is either a static value or a
 * factory function — we normalize it to a factory (or undefined) here so
 * each `.get()` call that returns null produces a fresh default (important
 * for mutable defaults like arrays/objects).
 */
function makeKeyAccessor<T>(
  name: string,
  ctx: StateContext,
  sched: Scheduler,
  adapt: <U>(p: restate.RestatePromise<U>) => Awaitable<U>,
  rawDefault: T | (() => T) | undefined,
  specSerde: restate.Serde<T> | undefined
): StateKeyAccessor<T, boolean> {
  const writeCtx = ctx as restate.ObjectContext;
  // Normalize default to a factory (or undefined when no default).
  const defaultFactory: (() => T) | undefined =
    rawDefault === undefined
      ? undefined
      : typeof rawDefault === "function"
        ? (rawDefault as () => T)
        : () => rawDefault as T;

  return {
    get(callSerde?: restate.Serde<T>): Future<T | null> {
      const serde = callSerde ?? specSerde;
      const p = adapt(
        ctx.get<T>(name, serde) as unknown as restate.RestatePromise<T | null>
      );
      if (defaultFactory !== undefined) {
        const factory = defaultFactory;
        return sched.makeJournalFuture(
          p.map((v, e) => {
            if (e !== undefined) throw e as Error;
            return v != null ? v : factory();
          })
        );
      }
      return sched.makeJournalFuture(p);
    },
    set(value: T, callSerde?: restate.Serde<T>): void {
      writeCtx.set(name, value, callSerde ?? specSerde);
    },
    clear(): void {
      writeCtx.clear(name);
    },
  };
}

/**
 * Build a typed accessor map from a config object.
 * Each key in the config gets its own accessor with the configured default
 * and serde.
 */
export function makeStateFromConfig<TConfig extends Record<string, AnyKeySpec>>(
  config: TConfig,
  ctx: StateContext,
  sched: Scheduler,
  adapt: <U>(p: restate.RestatePromise<U>) => Awaitable<U>
): StateAccessors<TConfig> {
  const result: Record<string, StateKeyAccessor<unknown, boolean>> = {};
  for (const key of Object.keys(config)) {
    const spec = config[key] ?? {};
    // TypedNoDefault markers have no default or serde; treat as plain key.
    const s: StateKeySpec = "_noDefaultType" in spec ? {} : spec;
    result[key] = makeKeyAccessor(
      key,
      ctx,
      sched,
      adapt,
      s.default,
      s.serde
    );
  }
  return result as unknown as StateAccessors<TConfig>;
}

/**
 * Build a single per-key accessor, given an optional spec.
 * Used by the lazy free-standing state() Proxy so each method call
 * creates exactly one accessor rather than the full map.
 */
export function makeKeyAccessorFromSpec<T>(
  name: string,
  spec: AnyKeySpec | undefined,
  ctx: StateContext,
  sched: Scheduler,
  adapt: <U>(p: restate.RestatePromise<U>) => Awaitable<U>
): StateKeyAccessor<T, boolean> {
  // TypedNoDefault markers carry no runtime info — treat as plain key.
  const s =
    spec && "_noDefaultType" in spec
      ? {}
      : (spec as StateKeySpec<T> | undefined);
  return makeKeyAccessor(name, ctx, sched, adapt, s?.default, s?.serde);
}

/**
 * Build an untyped accessor map for state<TShape>() calls (no config).
 * Returns a Proxy that creates per-key accessors on demand — since TShape
 * is erased at runtime we can't enumerate keys ahead of time.
 */
export function makeStateFromShape<TShape extends Record<string, unknown>>(
  ctx: StateContext,
  sched: Scheduler,
  adapt: <U>(p: restate.RestatePromise<U>) => Awaitable<U>
): UntypedStateAccessors<TShape> {
  const cache: Record<string, StateKeyAccessor<unknown, false>> = {};
  return new Proxy({} as UntypedStateAccessors<TShape>, {
    get(_target, prop: string) {
      if (!(prop in cache)) {
        cache[prop] = makeKeyAccessor(
          prop,
          ctx,
          sched,
          adapt,
          undefined,
          undefined
        );
      }
      return cache[prop];
    },
  });
}

// ---------------------------------------------------------------------------
// Flat untyped state operations (used by RestateOperations directly)
// ---------------------------------------------------------------------------

export function makeGetState(
  ctx: StateContext,
  sched: Scheduler,
  adapt: <U>(p: restate.RestatePromise<U>) => Awaitable<U>
): <T>(name: string, serde?: restate.Serde<T>) => Future<T | null> {
  return <T>(name: string, serde?: restate.Serde<T>) =>
    sched.makeJournalFuture(
      adapt(
        ctx.get<T>(name, serde) as unknown as restate.RestatePromise<T | null>
      )
    );
}

export function makeSetState(
  ctx: StateContext
): <T>(name: string, value: T, serde?: restate.Serde<T>) => void {
  const writeCtx = ctx as restate.ObjectContext;
  return <T>(name: string, value: T, serde?: restate.Serde<T>) =>
    writeCtx.set(name, value, serde);
}

export function makeClearState(ctx: StateContext): (name: string) => void {
  const writeCtx = ctx as restate.ObjectContext;
  return (name: string) => writeCtx.clear(name);
}

export function makeClearAllState(ctx: StateContext): () => void {
  const writeCtx = ctx as restate.ObjectContext;
  return () => writeCtx.clearAll();
}

export function makeGetAllStateKeys(
  ctx: StateContext,
  sched: Scheduler,
  adapt: <U>(p: restate.RestatePromise<U>) => Awaitable<U>
): () => Future<string[]> {
  return () =>
    sched.makeJournalFuture(
      adapt(ctx.stateKeys() as unknown as restate.RestatePromise<string[]>)
    );
}
