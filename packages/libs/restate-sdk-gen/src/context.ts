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

// Context-local storage
// =============================================================================
//
// Ambient, invocation-scoped key/value storage — a typed bag carried by
// the current invocation that generator code running under it (the main
// body, nested `gen` helpers, and spawned routines) can read and write
// without threading a parameter through every call.
//
// `get`/`set` must run on the fiber's synchronous advance span, i.e.
// directly from generator code — NOT from inside an `ops.run` action
// closure or any other async callback, which run off-advance (after the
// fiber has parked) and throw "outside an active fiber". To capture a
// journaled value into a slot, set it in the body from the run's result:
// `slot.set(yield* run(() => fetchTenant(), { name: "tenant" }))`, not
// `run(() => { slot.set(...) })`.
//
//   const tenant = contextLocal<string>();        // define once, anywhere
//
//   const handler = gen(function* () {
//     tenant.set(yield* run(() => resolveTenant(), { name: "tenant" }));
//     yield* doDeeplyNestedWork();   // reads tenant.get() without a param
//   });
//
// Scope and lifetime: ONE bag per `execute()` call. Every fiber that
// runs under that invocation — the main routine, everything it
// `spawn`s, and the synthetic fibers behind combinator fallbacks —
// shares the same bag (this is global-per-invocation, not per-fiber:
// there is no inheritance or per-strand isolation). The bag lives only
// in memory for the duration of the invocation; it is never journaled
// or persisted.
//
// Determinism: a value re-derived by deterministic workflow code is
// itself deterministic, so it survives replay/suspension unchanged —
// the workflow re-runs from the top and re-`set`s the same values, in
// the same order (fibers advance one at a time, in a replay-stable
// order). The same rule as a plain local variable applies: do not store
// a value you obtained non-deterministically (a bare `Date.now()`, a
// raw network result) unless it came through `run`/the journal first.
//
// NOT durable state: `contextLocal` is in-memory scratch for the current
// invocation. For values that must outlive the invocation (and be
// readable by later invocations of the same virtual object), use
// `state()` / `sharedState()`, which the SDK persists.
//
// Footgun: because the bag is shared, two concurrently-interleaving
// fibers that write the *same* key clobber each other — a reader sees
// whichever fiber advanced last. That is fine for the dominant use
// (set once near the top, read everywhere); only reach past it if you
// need per-strand isolation, which this global flavor does not provide.

import { getCurrent } from "./current.js";

/**
 * The slice of the current-fiber slot that backs context-local storage.
 * Both `Scheduler` (the slot in unit tests) and `RestateOperations` (the
 * slot in production) satisfy it structurally — `RestateOperations`
 * delegates to its scheduler, which owns the single per-invocation Map.
 * Kept here, cast from the `unknown` slot, so this module stays free of a
 * scheduler/operations import cycle (mirrors how `free.ts` reaches `ops`).
 */
interface ContextStore {
  /** Read `key`'s value, or `fallback` if it has never been set. */
  getLocal(key: symbol, fallback: unknown): unknown;
  /** Write `key`'s value for the rest of the invocation. */
  setLocal(key: symbol, value: unknown): void;
}

/**
 * A handle to one invocation-scoped slot. Mint it once with
 * {@link contextLocal} (at module scope is fine — minting touches no
 * fiber), then `get`/`set` it from inside the workflow body.
 */
export interface ContextLocal<T> {
  /**
   * Read this slot's value for the current invocation. Returns the
   * value previously {@link set} during this invocation, or the default
   * passed to {@link contextLocal} (or `undefined` if none) when it has
   * not been set. Must be called from generator code on the fiber's
   * synchronous span (a `gen` body running under `execute`); calling it
   * from an `ops.run` closure or other async callback throws.
   */
  // Arrow-property fields (not method shorthand) on purpose: method
  // parameters are checked bivariantly, which would let `ContextLocal<Dog>`
  // be treated as `ContextLocal<Animal>` and a widened `set` poison a `get`
  // that still claims `Dog`. As function-typed properties, `set`'s
  // parameter is contravariant, making the handle correctly invariant in T.
  get: () => T;
  /**
   * Set this slot's value for the rest of the current invocation,
   * visible to every fiber under it. Must be called from generator code
   * on the fiber's synchronous span; calling it from an `ops.run`
   * closure or other async callback throws.
   */
  set: (value: T) => void;
}

/**
 * Create a context-local storage slot.
 *
 * The returned handle's `get`/`set` read and write a bag scoped to the
 * current invocation (`execute` call) and shared by every fiber under
 * it. Each `contextLocal()` call mints an independent slot — two handles
 * never collide, even with the same value type.
 *
 * Minting is pure (it allocates a unique key and captures the default),
 * so a slot can be defined at module scope and reused across
 * invocations; only `get`/`set` touch the current fiber.
 *
 * @example A required value with a default
 *   const region = contextLocal("us-east-1");   // ContextLocal<string>
 *   // inside a handler:
 *   region.set("eu-west-1");
 *   const r = region.get();                       // string
 *
 * @example An optional value (no default)
 *   const traceId = contextLocal<string>();      // ContextLocal<string | undefined>
 *   const t = traceId.get();                       // string | undefined
 */
export function contextLocal<T>(defaultValue: T): ContextLocal<T>;
export function contextLocal<T>(): ContextLocal<T | undefined>;
export function contextLocal<T>(defaultValue?: T): ContextLocal<T | undefined> {
  // Identity-only key: the bag is keyed by this symbol, never serialized,
  // and lives only in-memory per invocation — so symbol identity (stable
  // within a process, irrelevant across processes) is the right key.
  const key = Symbol("restate.contextLocal");
  return {
    get: () =>
      (getCurrent() as ContextStore).getLocal(key, defaultValue) as
        | T
        | undefined,
    set: (value: T | undefined) =>
      (getCurrent() as ContextStore).setLocal(key, value),
  };
}
