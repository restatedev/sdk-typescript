// Operation<T>
// =============================================================================
//
// Operation<T> is a lazy, one-shot description of work that produces a T.
// Constructed via gen() for user-authored bodies, or by primitives that
// yield a marker the scheduler dispatches on (Leaf, Spawn, AwaitAny).
//
// The reuse trap from naked-generator designs is closed at the type level:
// gen() takes a factory `() => Generator<...>`, not a generator object, so
// `gen(bare())` doesn't typecheck — you have to write `gen(() => bare())`,
// which produces a fresh body per `[Symbol.iterator]()` call.

import type { Future } from "./future.js";
import type { Settled } from "./scheduler-types.js";

export const opTag = Symbol("restateOperation");

export interface Operation<T> {
  [Symbol.iterator](): Iterator<unknown, T, unknown>;
}

// =============================================================================
// Primitive nodes — only the scheduler interprets these.
// =============================================================================

export type LeafNode<T> = {
  readonly _tag: "Leaf";
  readonly future: Future<T>;
};

export type SpawnNode<T> = {
  readonly _tag: "Spawn";
  readonly child: Operation<T>;
};

export type AwaitRaceResult = { index: number; settled: Settled };

export type AwaitRace = {
  readonly _tag: "AwaitRace";
  readonly futures: ReadonlyArray<Future<unknown>>;
};

export type Node<T> = LeafNode<T> | SpawnNode<T>;

export interface PrimitiveOp<T> extends Operation<T> {
  readonly [opTag]: Node<T> | AwaitRace;
}

export function makePrimitive<T>(node: Node<T>): PrimitiveOp<T> {
  const op = {
    [opTag]: node,
    *[Symbol.iterator]() {
      return (yield op) as T;
    },
  };
  return op;
}

// AwaitAny is module-internal — used by combinator implementations inside
// this package (race, select). It never appears in the user API.
export function awaitRace<T>(
  futures: ReadonlyArray<Future<T>>
): Operation<AwaitRaceResult> {
  const op = {
    [opTag]: { _tag: "AwaitRace", futures } as AwaitRace,
    *[Symbol.iterator]() {
      return (yield op) as AwaitRaceResult;
    },
  };
  return op as unknown as Operation<AwaitRaceResult>;
}

// =============================================================================
// gen — the only way to lift a generator function into an Operation.
// =============================================================================

export function gen<T>(
  body: () => Generator<unknown, T, unknown>
): Operation<T> {
  return { [Symbol.iterator]: body };
}

// =============================================================================
// spawn — register a child operation as a new routine, get back a Future<T>.
// =============================================================================
//
// `yield* spawn(op)` registers op as a fresh routine and resolves with a
// Future<T> the caller can park on, hand around, or pass to combinators.

export function spawn<T>(op: Operation<T>): Operation<Future<T>> {
  // makePrimitive's generic parameter is the *yield resume type* — for
  // Spawn, that's Future<T>, since the scheduler resumes the yielder
  // with a Future.
  const node: SpawnNode<T> = { _tag: "Spawn", child: op };
  return makePrimitive<Future<T>>(node as unknown as Node<Future<T>>);
}

// =============================================================================
// select — wait for one branch to settle, return its tag and the future.
// =============================================================================
//
// The user unwraps the future after switching on the tag — `yield* r.future`
// is effectively sync at that point since it's already settled. select
// doesn't propagate the value or the error: telling you which branch is
// ready is its only job.

export type SelectResult<B extends Record<string, Future<unknown>>> = {
  [K in keyof B]: { tag: K; future: B[K] };
}[keyof B];

export function* select<B extends Record<string, Future<unknown>>>(
  branches: B
): Generator<unknown, SelectResult<B>, unknown> {
  const tags = Object.keys(branches) as Array<keyof B & string>;
  const futures = tags.map((t) => branches[t]) as Future<unknown>[];
  const result = yield* awaitRace(futures);
  const tag = tags[result.index]!;
  return { tag, future: branches[tag] } as SelectResult<B>;
}
