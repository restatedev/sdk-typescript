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

import { RetrySettings } from "./utils/public_utils";
import {
  Client,
  SendClient,
  ServiceDefintion,
  VirtualObjectDefintion,
} from "./types/rpc";
import { ContextImpl } from "./context_impl";

/**
 * Represents the original request as sent to this handler.
 *
 * A request object includes the request headers, and the raw unparsed
 * request body.
 */
export interface Request {
  /**
   * The unique id that identifies the current function invocation. This id is guaranteed to be
   * unique across invocations, but constant across reties and suspensions.
   */
  readonly id: Buffer;

  /**
   * Request headers
   */
  readonly headers: ReadonlyMap<string, string>;

  /**
   * Raw unparsed request body
   */
  readonly body: Uint8Array;
}

/**
 * Key value store operations. Only keyed services have an attached key-value store.
 */
export interface KeyValueStore {
  /**
   * Get/retrieve state from the Restate runtime.
   * Note that state objects are serialized with `Buffer.from(JSON.stringify(theObject))`
   * and deserialized with `JSON.parse(value.toString()) as T`.
   *
   * @param name key of the state to retrieve
   * @returns a Promise that is resolved with the value of the state key
   *
   * @example
   * const ctx = restate.useContext(this);
   * const state = await ctx.get<string>("STATE");
   */
  get<T>(name: string): Promise<T | null>;

  stateKeys(): Promise<Array<string>>;

  /**
   * Set/store state in the Restate runtime.
   * Note that state objects are serialized with `Buffer.from(JSON.stringify(theObject))`
   * and deserialized with `JSON.parse(value.toString()) as T`.
   *
   * @param name key of the state to set
   * @param value value to set
   *
   * @example
   * const ctx = restate.useContext(this);
   * ctx.set("STATE", "Hello");
   */
  set<T>(name: string, value: T): void;

  /**
   * Clear/delete state in the Restate runtime.
   * @param name key of the state to delete
   *
   * @example
   * const ctx = restate.useContext(this);
   * ctx.clear("STATE");
   */
  clear(name: string): void;

  /**
   * Clear/delete all the state entries in the Restate runtime.
   *
   * @example
   * const ctx = restate.useContext(this);
   * ctx.clearAll();
   */
  clearAll(): void;
}

export interface ContextDate {
  /** Returns the number of milliseconds elapsed since midnight, January 1, 1970 Universal Coordinated Time (UTC).
   *  This is equivalent to Date.now()
   */
  now(): Promise<number>;
  /** Returns the JSON represention of the current date.
   * This is equivalent to new Date().toJSON()
   **/
  toJSON(): Promise<string>;
}

/**
 * The context that gives access to all Restate-backed operations, for example
 *   - sending reliable messages / RPC through Restate
 *   - side effects
 *   - sleeps and delayed calls
 *   - awakeables
 *   - ...
 *
 * Keyed services can also access their key-value store using the {@link ObjectContext}.
 *
 */
export interface Context {
  /**
   * Deterministic random methods; these are inherently predictable (seeded on the invocation ID, which is not secret)
   * and so should not be used for any cryptographic purposes. They are useful for identifiers, idempotency keys,
   * and for uniform sampling from a set of options. If a cryptographically secure value is needed, please generate that
   * externally and capture the result with a side effect.
   *
   * Calls to these methods from inside side effects are disallowed and will fail - side effects must be idempotent, and
   * these calls are not.
   */
  rand: Rand;

  /**
   * Console to use for logging. It attaches to each log message some contextual information,
   * such as invoked service method and invocation id, and automatically excludes logs during replay.
   */
  console: Console;

  /**
   * Deterministic date.
   */
  date: ContextDate;

  /**
   * Execute a side effect and store the result in Restate. The side effect will thus not
   * be re-executed during a later replay, but take the durable result from Restate.
   *
   * Side effects let you capture potentially non-deterministic computation and interaction
   * with external systems in a safe way.
   *
   * Failure semantics of side effects are:
   *   - If a side effect executed and persisted before, the result (value or Error) will be
   *     taken from the Restate journal.
   *   - There is a small window where a side effect may be re-executed twice, if a failure
   *     occurred between execution and persisting the result.
   *   - No second side effect will be executed while a previous side effect's result is not
   *     yet durable. That way, side effects that build on top of each other can assume
   *     deterministic results from previous effects, and at most one side effect will be
   *     re-executed on replay (the latest, if the failure happened in the small windows
   *     described above).
   *
   * This function takes an optional retry policy, that determines what happens if the
   * side effect throws an error. The default retry policy retries infinitely, with exponential
   * backoff and uses suspending sleep for the wait times between retries.
   *
   * @example
   * const ctx = restate.useContext(this);
   * const result = await ctx.sideEffect(async () => someExternalAction() )
   *
   * @example
   * const paymentAction = async () => {
   *   const result = await paymentClient.call(txId, methodIdentifier, amount);
   *   if (result.error) {
   *     throw result.error;
   *   } else {
   *     return result.payment_accepted;
   *   }
   * }
   * const paymentAccepted: boolean =
   *   await ctx.sideEffect(paymentAction, { maxRetries: 10});
   *
   * @param fn The function to run as a side effect.
   * @param retryPolicy The optional policy describing how retries happen.
   */
  sideEffect<T>(fn: () => Promise<T>, retryPolicy?: RetrySettings): Promise<T>;

  /**
   * Register an awakeable and pause the processing until the awakeable ID (and optional payload) have been returned to the service
   * (via ctx.completeAwakeable(...)). The SDK deserializes the payload with `JSON.parse(result.toString()) as T`.
   * @returns
   * - id: the string ID that has to be used to complete the awakaeble by some external service
   * - promise: the Promise that needs to be awaited and that is resolved with the payload that was supplied by the service which completed the awakeable
   *
   * @example
   * const ctx = restate.useContext(this);
   * const awakeable = ctx.awakeable<string>();
   *
   * // send the awakeable ID to some external service that will wake this one back up
   * // The ID can be retrieved by:
   * const id = awakeable.id;
   *
   * // ... send to external service ...
   *
   * // Wait for the external service to wake this service back up
   * const result = await awakeable.promise;
   */
  awakeable<T>(): { id: string; promise: CombineablePromise<T> };

  /**
   * Resolve an awakeable of another service.
   * @param id the string ID of the awakeable.
   * This is supplied by the service that needs to be woken up.
   * @param payload the payload to pass to the service that is woken up.
   * The SDK serializes the payload with `Buffer.from(JSON.stringify(payload))`
   * and deserializes it in the receiving service with `JSON.parse(result.toString()) as T`.
   *
   * @example
   * const ctx = restate.useContext(this);
   * // The sleeping service should have sent the awakeableIdentifier string to this service.
   * ctx.resolveAwakeable(awakeableIdentifier, "hello");
   */
  resolveAwakeable<T>(id: string, payload?: T): void;

  /**
   * Reject an awakeable of another service. When rejecting, the service waiting on this awakeable will be woken up with a terminal error with the provided reason.
   * @param id the string ID of the awakeable.
   * This is supplied by the service that needs to be woken up.
   * @param reason the reason of the rejection.
   *
   * @example
   * const ctx = restate.useContext(this);
   * // The sleeping service should have sent the awakeableIdentifier string to this service.
   * ctx.rejectAwakeable(awakeableIdentifier, "super bad error");
   */
  rejectAwakeable(id: string, reason: string): void;

  /**
   * Sleep until a timeout has passed.
   * @param millis duration of the sleep in millis.
   * This is a lower-bound.
   *
   * @example
   * const ctx = restate.useContext(this);
   * await ctx.sleep(1000);
   */
  sleep(millis: number): CombineablePromise<void>;

  /**
   * Makes a type-safe request/response RPC to the specified target service.
   *
   * The RPC goes through Restate and is guaranteed to be reliably delivered. The RPC is also
   * journaled for durable execution and will thus not be duplicated when the handler is re-invoked
   * for retries or after suspending.
   *
   * This call will return the result produced by the target handler, or the Error, if the target
   * handler finishes with a Terminal Error.
   *
   * This call is a suspension point: The handler might suspend while awaiting the response and
   * resume once the response is available.
   *
   * @example
   * *Service Side:*
   * ```ts
   * const router = restate.router({
   *   someAction:    async(ctx: restate.RpcContext, req: string) => { ... },
   *   anotherAction: async(ctx: restate.RpcContext, count: number) => { ... }
   * });
   *
   * // option 1: export only the type signature of the router
   * export type myApiType = typeof router;
   *
   * // option 2: export the API definition with type and name (path)
   * export const myApi: restate.ServiceApi<typeof router> = { path : "myservice" };
   *
   * restate.createServer().bindRouter("myservice", router).listen(9080);
   * ```
   * **Client side:**
   * ```ts
   * // option 1: use only types and supply service name separately
   * const result1 = await ctx.rpc<myApiType>({path: "myservice"}).someAction("hello!");
   *
   * // option 2: use full API spec
   * const result2 = await ctx.rpc(myApi).anotherAction(1337);
   * ```
   */
  service<P extends string, M>(opts: ServiceDefintion<P, M>): Client<M>;

  object<P extends string, M>(
    opts: VirtualObjectDefintion<P, M>,
    key: string
  ): Client<M>;

  /**
   * Makes a type-safe one-way RPC to the specified target service. This method effectively behaves
   * like enqueuing the message in a message queue.
   *
   * The message goes through Restate and is guaranteed to be reliably delivered. The RPC is also
   * journaled for durable execution and will thus not be duplicated when the handler is re-invoked
   * for retries or after suspending.
   *
   * This call will return immediately; the message sending happens asynchronously in the background.
   * Despite that, the message is guaranteed to be sent, because the completion of the invocation that
   * triggers the send (calls this function) happens logically after the sending. That means that any
   * failure where the message does not reach Restate also cannot complete this invocation, and will
   * hence recover this handler and (through the durable execution) recover the message to be sent.
   *
   * @example
   * *Service Side:*
   * ```ts
   * const router = restate.router({
   *   someAction:    async(ctx: restate.RpcContext, req: string) => { ... },
   *   anotherAction: async(ctx: restate.RpcContext, count: number) => { ... }
   * });
   *
   * // option 1: export only the type signature of the router
   * export type myApiType = typeof router;
   *
   * // option 2: export the API definition with type and name (path)
   * export const myApi: restate.ServiceApi<typeof router> = { path : "myservice" };
   *
   * restate.createServer().bindRouter("myservice", router).listen(9080);
   * ```
   * **Client side:**
   * ```ts
   * // option 1: use only types and supply service name separately
   * ctx.send<myApiType>({path: "myservice"}).someAction("hello!");
   *
   * // option 2: use full API spec
   * ctx.send(myApi).anotherAction(1337);
   * ```
   */
  objectSend<P extends string, M>(
    opts: VirtualObjectDefintion<P, M>,
    key: string
  ): SendClient<M>;
  serviceSend<P extends string, M>(opts: ServiceDefintion<P, M>): SendClient<M>;

  /**
   * Makes a type-safe one-way RPC to the specified target service, after a delay specified by the
   * milliseconds' argument.
   * This method is like stetting up a fault-tolerant cron job that enqueues the message in a
   * message queue.
   * The handler calling this function does not have to stay active for the delay time.
   *
   * Both the delay timer and the message are durably stored in Restate and guaranteed to be reliably
   * delivered. The delivery happens no earlier than specified through the delay, but may happen
   * later, if the target service is down, or backpressuring the system.
   *
   * The delay message is journaled for durable execution and will thus not be duplicated when the
   * handler is re-invoked for retries or after suspending.
   *
   * This call will return immediately; the message sending happens asynchronously in the background.
   * Despite that, the message is guaranteed to be sent, because the completion of the invocation that
   * triggers the send (calls this function) happens logically after the sending. That means that any
   * failure where the message does not reach Restate also cannot complete this invocation, and will
   * hence recover this handler and (through the durable execution) recover the message to be sent.
   *
   * @example
   * *Service Side:*
   * ```ts
   * const router = restate.router({
   *   someAction:    async(ctx: restate.RpcContext, req: string) => { ... },
   *   anotherAction: async(ctx: restate.RpcContext, count: number) => { ... }
   * });
   *
   * // option 1: export only the type signature of the router
   * export type myApiType = typeof router;
   *
   * // option 2: export the API definition with type and name (path)
   * export const myApi: restate.ServiceApi<typeof router> = { path : "myservice" };
   *
   * restate.createServer().bindRouter("myservice", router).listen(9080);
   * ```
   * **Client side:**
   * ```ts
   * // option 1: use only types and supply service name separately
   * ctx.sendDelayed<myApiType>({path: "myservice"}, 60_000).someAction("hello!");
   *
   * // option 2: use full API spec
   * ctx.sendDelayed(myApi, 60_000).anotherAction(1337);
   * ```
   */
  objectSendDelayed<P extends string, M>(
    opts: VirtualObjectDefintion<P, M>,
    delay: number,
    key: string
  ): SendClient<M>;

  serviceSendDelayed<P extends string, M>(
    opts: ServiceDefintion<P, M>,
    delay: number
  ): SendClient<M>;

  /**
   * Returns the raw request that triggered that handler.
   * Use that object to inspect the original request headers
   */
  request(): Request;
}

/**
 * The context that gives access to all Restate-backed operations, for example
 *   - sending reliable messages / RPC through Restate
 *   - access/update state
 *   - side effects
 *   - sleeps and delayed calls
 *   - awakeables
 *   - ...
 *
 * This context can be used only within keyed services/routers.
 *
 */
export interface ObjectContext extends Context, KeyValueStore {
  key(): string;
}

export interface Rand {
  /**
   * Equivalent of JS `Math.random()` but deterministic; seeded by the invocation ID of the current invocation,
   * each call will return a new pseudorandom float within the range [0,1)
   */
  random(): number;

  /**
   * Using the same random source and seed as random(), produce a UUID version 4 string. This is inherently predictable
   * based on the invocation ID and should not be used in cryptographic contexts
   */
  uuidv4(): string;
}

/**
 * A promise that can be combined using Promise combinators in RestateContext.
 */
export type CombineablePromise<T> = Promise<T> & {
  __restate_context: Context;

  /**
   * Creates a promise that awaits for the current promise up to the specified timeout duration.
   * If the timeout is fired, this Promise will be rejected with a {@link TimeoutError}.
   *
   * @param millis duration of the sleep in millis.
   * This is a lower-bound.
   */
  orTimeout(millis: number): Promise<T>;
};

export const CombineablePromise = {
  /**
   * Creates a Promise that is resolved with an array of results when all of the provided Promises
   * resolve, or rejected when any Promise is rejected.
   *
   * See {@link Promise.all} for more details.
   *
   * @param values An iterable of Promises.
   * @returns A new Promise.
   */
  all<T extends readonly CombineablePromise<unknown>[] | []>(
    values: T
  ): Promise<{ -readonly [P in keyof T]: Awaited<T[P]> }> {
    if (values.length == 0) {
      return Promise.all(values);
    }

    return (values[0].__restate_context as ContextImpl).createCombinator(
      Promise.all.bind(Promise),
      values
    ) as Promise<{
      -readonly [P in keyof T]: Awaited<T[P]>;
    }>;
  },

  /**
   * Creates a Promise that is resolved or rejected when any of the provided Promises are resolved
   * or rejected.
   *
   * See {@link Promise.race} for more details.
   *
   * @param values An iterable of Promises.
   * @returns A new Promise.
   */
  race<T extends readonly CombineablePromise<unknown>[] | []>(
    values: T
  ): Promise<Awaited<T[number]>> {
    if (values.length == 0) {
      return Promise.race(values);
    }

    return (values[0].__restate_context as ContextImpl).createCombinator(
      Promise.race.bind(Promise),
      values
    ) as Promise<Awaited<T[number]>>;
  },

  /**
   * Creates a promise that fulfills when any of the input's promises fulfills, with this first fulfillment value.
   * It rejects when all the input's promises reject (including when an empty iterable is passed),
   * with an AggregateError containing an array of rejection reasons.
   *
   * See {@link Promise.any} for more details.
   *
   * @param values An iterable of Promises.
   * @returns A new Promise.
   */
  any<T extends readonly CombineablePromise<unknown>[] | []>(
    values: T
  ): Promise<Awaited<T[number]>> {
    if (values.length == 0) {
      return Promise.any(values);
    }

    return (values[0].__restate_context as ContextImpl).createCombinator(
      Promise.any.bind(Promise),
      values
    ) as Promise<Awaited<T[number]>>;
  },

  /**
   * Creates a promise that fulfills when all the input's promises settle (including when an empty iterable is passed),
   * with an array of objects that describe the outcome of each promise.
   *
   * See {@link Promise.allSettled} for more details.
   *
   * @param values An iterable of Promises.
   * @returns A new Promise.
   */
  allSettled<T extends readonly CombineablePromise<unknown>[] | []>(
    values: T
  ): Promise<{
    -readonly [P in keyof T]: PromiseSettledResult<Awaited<T[P]>>;
  }> {
    if (values.length == 0) {
      return Promise.allSettled(values);
    }

    return (values[0].__restate_context as ContextImpl).createCombinator(
      Promise.allSettled.bind(Promise),
      values
    ) as Promise<{
      -readonly [P in keyof T]: PromiseSettledResult<Awaited<T[P]>>;
    }>;
  },
};

/**
 * @deprecated use {@link ObjectContext}.
 */
export type RestateContext = ObjectContext;
