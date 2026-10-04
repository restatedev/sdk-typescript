/*
 * Copyright (c) 2023-2024 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type {
  Serde,
  Service,
  ServiceDefinitionFrom,
  VirtualObject,
  VirtualObjectDefinitionFrom,
  Workflow,
  WorkflowDefinitionFrom,
} from "@restatedev/restate-sdk-core";
import type {
  GenericSend,
  Rand,
  Request,
  TypedState,
  UntypedState,
} from "./context.js";
import type { InferArg, SendOpts } from "./types/rpc.js";

/**
 * Key type of {@link ActorKV}: any string for untyped state, otherwise one of the keys of `TState`.
 *
 * @experimental
 */
export type ActorKVKey<
  TState extends TypedState,
  TKey,
> = TState extends UntypedState ? string : TKey;

/**
 * Value type of {@link ActorKV}: `TValue` for untyped state, otherwise the type of `TKey` in `TState`.
 *
 * @experimental
 */
export type ActorKVValue<
  TState extends TypedState,
  TValue,
  TKey extends keyof TState,
> = TState extends UntypedState ? TValue : TState[TKey];

/**
 * Read-only view of the actor key-value store.
 *
 * Reads are served from the snapshot of the state the runtime ships with the invocation:
 * they are synchronous and they are not recorded in the journal.
 *
 * Every read deserializes the stored value: mutating a returned object doesn't change the stored value,
 * use {@link ActorKV.set} or {@link ActorKV.update} for that.
 *
 * @experimental
 */
export interface ReadonlyActorKV<TState extends TypedState = UntypedState> {
  /**
   * Get the value of `key`, or `undefined` if the key is not set.
   */
  get<TValue, TKey extends keyof TState = string>(
    key: ActorKVKey<TState, TKey>,
    serde?: Serde<ActorKVValue<TState, TValue, TKey>>
  ): ActorKVValue<TState, TValue, TKey> | undefined;

  /**
   * Returns true if `key` is set.
   */
  has<TKey extends keyof TState = string>(
    key: ActorKVKey<TState, TKey>
  ): boolean;

  /**
   * List the keys, in lexicographic order, optionally filtered by `prefix`.
   */
  keys(prefix?: string): string[];

  /**
   * List the entries, in lexicographic order of keys, optionally filtered by key `prefix`.
   */
  entries<TValue = any>(
    prefix?: string,
    serde?: Serde<TValue>
  ): Array<[string, TValue]>;
}

/**
 * The actor key-value store.
 *
 * Writes are buffered, and they become visible to subsequent reads in the same invocation.
 * They are committed atomically together with the handler result and the outgoing messages when the handler returns,
 * or discarded if the handler fails.
 *
 * @experimental
 */
export interface ActorKV<
  TState extends TypedState = UntypedState,
> extends ReadonlyActorKV<TState> {
  /**
   * Set `key` to `value`.
   */
  set<TValue, TKey extends keyof TState = string>(
    key: ActorKVKey<TState, TKey>,
    value: ActorKVValue<TState, TValue, TKey>,
    serde?: Serde<ActorKVValue<TState, TValue, TKey>>
  ): void;

  /**
   * Delete `key`. Returns true if the key was set.
   */
  delete<TKey extends keyof TState = string>(
    key: ActorKVKey<TState, TKey>
  ): boolean;

  /**
   * Read-modify-write `key`: `fn` receives the current value (or `undefined`) and returns the new value.
   * Returning `undefined` deletes the key. Returns the new value.
   */
  update<TValue, TKey extends keyof TState = string>(
    key: ActorKVKey<TState, TKey>,
    fn: (
      current: ActorKVValue<TState, TValue, TKey> | undefined
    ) => ActorKVValue<TState, TValue, TKey> | undefined,
    serde?: Serde<ActorKVValue<TState, TValue, TKey>>
  ): ActorKVValue<TState, TValue, TKey> | undefined;

  /**
   * Delete all the keys starting with `prefix`, or all the keys if no prefix is provided.
   */
  clear(prefix?: string): void;
}

/**
 * Send client for actor handlers. Messages are sent only if the actor handler commits.
 *
 * @experimental
 */
export type ActorSendClient<M> = {
  [K in keyof M as M[K] extends never ? never : K]: M[K] extends (
    arg: any,
    ...args: infer P
  ) => void
    ? (...args: [...P, ...[opts?: SendOpts<InferArg<P>>]]) => void
    : never;
};

/**
 * Context of read-only actor handlers, see {@link handlers.actor.shared}.
 *
 * @experimental
 */
export interface ActorSharedContext<TState extends TypedState = UntypedState> {
  /**
   * The key of this actor.
   */
  readonly key: string;

  /**
   * Read-only view of the actor state.
   */
  readonly kv: ReadonlyActorKV<TState>;

  /**
   * Console to use for logging, with contextual information attached.
   */
  readonly console: Console;

  /**
   * Random generator seeded with the invocation id.
   */
  readonly rand: Rand;

  request(): Request;
}

/**
 * Context of actor handlers.
 *
 * An actor handler runs to completion against an in-memory view of the actor state, without recording any step in the journal.
 * When it returns, the state mutations, the outgoing messages and the result are committed atomically:
 * either all of them become visible, or none of them does.
 *
 * * If the handler throws a {@link TerminalError}, its writes and messages are discarded, and the error is the invocation result.
 * * If the handler throws any other error, or the attempt fails before the commit is durable,
 *   nothing is committed and the handler is executed again from scratch on the next attempt.
 *   Code with external side effects is thus executed at least once.
 *
 * Actor handlers can't await other Restate operations, such as calls, sleeps or awakeables.
 * Use one-way messages instead (e.g. send a message to another service, and have it reply back with another message),
 * or regular journaled handlers on the same actor.
 *
 * @experimental
 */
export interface ActorContext<
  TState extends TypedState = UntypedState,
> extends ActorSharedContext<TState> {
  /**
   * The actor state.
   */
  readonly kv: ActorKV<TState>;

  /**
   * Send a message to a service. The message is sent only if this handler commits.
   */
  serviceSendClient<D>(
    service: ServiceDefinitionFrom<D>
  ): ActorSendClient<Service<D>>;

  /**
   * Send a message to a virtual object or actor. The message is sent only if this handler commits.
   *
   * Use the `delay` option to schedule a message, e.g. to implement timers by sending a message to this same actor.
   */
  objectSendClient<D>(
    obj: VirtualObjectDefinitionFrom<D>,
    key: string
  ): ActorSendClient<VirtualObject<D>>;

  /**
   * Send a message to a workflow. The message is sent only if this handler commits.
   */
  workflowSendClient<D>(
    workflow: WorkflowDefinitionFrom<D>,
    key: string
  ): ActorSendClient<Workflow<D>>;

  /**
   * Send a message. The message is sent only if this handler commits.
   */
  genericSend<REQ = Uint8Array>(send: GenericSend<REQ>): void;
}
