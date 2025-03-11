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

import type { Client, SendClient } from "./types/rpc.js";
import type {
  RestateContext,
  RestateObjectContext,
  RestateObjectSharedContext,
  RestateWorkflowContext,
  RestateWorkflowSharedContext,
  Service,
  ServiceDefinitionFrom,
  VirtualObject,
  VirtualObjectDefinitionFrom,
  Workflow,
  WorkflowDefinitionFrom,
  Serde,
} from "@restatedev/restate-sdk-core";
import { ContextImpl } from "./context_impl.js";

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
  readonly id: string;

  /**
   * Request headers - the following headers capture the original invocation headers, as provided to
   * the ingress.
   */
  readonly headers: ReadonlyMap<string, string>;

  /**
   * Attempt headers - the following headers are sent by the restate runtime.
   * These headers are attempt specific, generated by the restate runtime uniquely for each attempt.
   * These headers might contain information such as the W3C trace context, and attempt specific information.
   */
  readonly attemptHeaders: ReadonlyMap<string, string | string[] | undefined>;

  /**
   * Raw unparsed request body
   */
  readonly body: Uint8Array;

  /**
   * Extra arguments provided to the request handler:
   * Lambda: [Context]
   * Cloudflare workers: [Env, ExecutionContext]
   * Deno: [ConnInfo]
   * Bun: [Server]
   * These arguments can contain request-specific values that could change after a suspension.
   * Care should be taken to use them deterministically.
   */
  readonly extraArgs: unknown[];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export type TypedState = Record<string, any>;
export type UntypedState = { _: never };

/**
 * Key value store operations. Only keyed services have an attached key-value store.
 */
export interface KeyValueStore<TState extends TypedState> {
  /**
   * Get/retrieve state from the Restate runtime.
   * Note that state objects are serialized with `Buffer.from(JSON.stringify(theObject))`
   * and deserialized with `JSON.parse(value.toString()) as T`.
   *
   * @param name key of the state to retrieve
   * @returns a Promise that is resolved with the value of the state key
   *
   * @example
   * const state = await ctx.get<string>("STATE");
   */
  get<TValue, TKey extends keyof TState = string>(
    name: TState extends UntypedState ? string : TKey,
    serde?: Serde<TState extends UntypedState ? TValue : TState[TKey]>
  ): Promise<(TState extends UntypedState ? TValue : TState[TKey]) | null>;

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
   * ctx.set("STATE", "Hello");
   */
  set<TValue, TKey extends keyof TState = string>(
    name: TState extends UntypedState ? string : TKey,
    value: TState extends UntypedState ? TValue : TState[TKey],
    serde?: Serde<TState extends UntypedState ? TValue : TState[TKey]>
  ): void;

  /**
   * Clear/delete state in the Restate runtime.
   * @param name key of the state to delete
   *
   * @example
   * ctx.clear("STATE");
   */
  clear<TKey extends keyof TState>(
    name: TState extends UntypedState ? string : TKey
  ): void;

  /**
   * Clear/delete all the state entries in the Restate runtime.
   *
   * @example
   * ctx.clearAll();
   */
  clearAll(): void;
}

export interface SendOptions {
  /**
   * Makes a type-safe one-way RPC to the specified target service, after a delay specified by the
   * milliseconds' argument.
   * This method is like setting up a fault-tolerant cron job that enqueues the message in a
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
   * ```ts
   * ctx.serviceSendClient(Service, {delay: 60_000}).anotherAction(1337);
   * ```
   */
  delay?: number;
}

export interface ContextDate {
  /** Returns the number of milliseconds elapsed since midnight, January 1, 1970 Universal Coordinated Time (UTC).
   *  This is equivalent to Date.now()
   */
  now(): Promise<number>;
  /** Returns the JSON representation of the current date.
   * This is equivalent to new Date().toJSON()
   **/
  toJSON(): Promise<string>;
}

/**
 * A function that can be run and its result durably persisted by Restate.
 */
export type RunAction<T> = (() => Promise<T>) | (() => T);

export type RunOptions<T> = {
  serde?: Serde<T>;

  /**
   * Max number of retry attempts, before giving up.
   *
   * When giving up, `ctx.run` will throw a `TerminalError` wrapping the original error message.
   */
  maxRetryAttempts?: number;

  /**
   * Max duration of retries, before giving up.
   *
   * When giving up, `ctx.run` will throw a `TerminalError` wrapping the original error message.
   */
  maxRetryDurationMillis?: number;

  /**
   * Initial interval for the first retry attempt.
   * Retry interval will grow by a factor specified in `retryIntervalFactor`.
   *
   * The default is 50 milliseconds.
   */
  initialRetryIntervalMillis?: number;

  /**
   * Max interval between retries.
   * Retry interval will grow by a factor specified in `retryIntervalFactor`.
   *
   * The default is 10 seconds.
   */
  maxRetryIntervalMillis?: number;

  /**
   * Exponentiation factor to use when computing the next retry delay.
   *
   * The default value is `2`, meaning retry interval will double at each attempt.
   */
  retryIntervalFactor?: number;
};

/**
 * Call a handler directly avoiding restate's type safety checks.
 * This is a generic mechanism to invoke handlers directly by only knowing
 * the service and handler name, (or key in the case of objects or workflows)
 */
export type GenericCall<REQ, RES> = {
  service: string;
  method: string;
  parameter: REQ;
  key?: string;
  headers?: Record<string, string>;
  inputSerde?: Serde<REQ>;
  outputSerde?: Serde<RES>;
  idempotencyKey?: string;
};

/**
 * Send a message to an handler directly avoiding restate's type safety checks.
 * This is a generic machnisim to invoke handlers directly by only knowing
 * the service and handler name, (or key in the case of objects or workflows)
 */
export type GenericSend<REQ> = {
  service: string;
  method: string;
  parameter: REQ;
  key?: string;
  headers?: Record<string, string>;
  inputSerde?: Serde<REQ>;
  delay?: number;
  idempotencyKey?: string;
};

/**
 * The context that gives access to all Restate-backed operations, for example
 *   - sending reliable messages / RPC through Restate
 *   - execute non-deterministic closures and memoize their result
 *   - sleeps and delayed calls
 *   - awakeables
 *   - ...
 *
 * Virtual objects can also access their key-value store using the {@link ObjectContext}.
 *
 */
export interface Context extends RestateContext {
  /**
   * Deterministic random methods; these are inherently predictable (seeded on the invocation ID, which is not secret)
   * and so should not be used for any cryptographic purposes. They are useful for identifiers, idempotency keys,
   * and for uniform sampling from a set of options. If a cryptographically secure value is needed, please generate that
   * externally and capture the result with a side effect.
   *
   * Calls to these methods from inside `ctx.run` are disallowed and will fail - side effects must be idempotent, and
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
   * Run an operation and store the result in Restate. The operation will thus not
   * be re-run during a later replay, but take the durable result from Restate.
   *
   * This let you capture potentially non-deterministic computation and interaction
   * with external systems in a safe way.
   *
   * Failure semantics are:
   *   - If an operation has run and persisted before, the result (value or Error) will be
   *     taken from the Restate journal.
   *   - There is a small window where an action may be re-run, if a failure
   *     occurred between a successful run and persisting the result.
   *   - No second action will be run while a previous run's result is not
   *     yet durable. That way, effects that build on top of each other can assume
   *     deterministic results from previous runs, and at most one run will be
   *     re-executed on replay (the latest, if the failure happened in the small windows
   *     described above).
   *
   * @example
   * ```ts
   * const result = await ctx.run(someExternalAction)
   *```

   * @example
   * ```ts
   *    await ctx.run("payment action", async () => {
   *        const result = await paymentProvider.charge(txId, paymentInfo);
   *        if (result.paymentRejected) {
   *            // this action will not be retried anymore
   *            throw new TerminalError("Payment failed");
   *        } else if (result.paymentGatewayBusy) {
   *            // restate will retry automatically
   *            // to bound retries, use RunOptions
   *            throw new Exception("Payment gateway busy");
   *        } else {
   *            // success!
   *        }
   *   });
   *
   * ```
   *
   * @param action The function to run.
   */
  run<T>(action: RunAction<T>): CombineablePromise<T>;

  /**
   * Run an operation and store the result in Restate. The operation will thus not
   * be re-run during a later replay, but take the durable result from Restate.
   *
   * @param name the action's name
   * @param action the action to run.
   */
  run<T>(name: string, action: RunAction<T>): CombineablePromise<T>;

  run<T>(
    name: string,
    action: RunAction<T>,
    options: RunOptions<T>
  ): CombineablePromise<T>;

  /**
   * Register an awakeable and pause the processing until the awakeable ID (and optional payload) have been returned to the service
   * (via ctx.completeAwakeable(...)). The SDK deserializes the payload with `JSON.parse(result.toString()) as T`.
   * @returns
   * - id: the string ID that has to be used to complete the awakaeble by some external service
   * - promise: the Promise that needs to be awaited and that is resolved with the payload that was supplied by the service which completed the awakeable
   *
   * @example
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
  awakeable<T>(serde?: Serde<T>): {
    id: string;
    promise: CombineablePromise<T>;
  };

  /**
   * Resolve an awakeable.
   * @param id the string ID of the awakeable.
   * This is supplied by the service that needs to be woken up.
   * @param payload the payload to pass to the service that is woken up.
   * The SDK serializes the payload with `Buffer.from(JSON.stringify(payload))`
   * and deserializes it in the receiving service with `JSON.parse(result.toString()) as T`.
   *
   * @example
   * // The sleeping service should have sent the awakeableIdentifier string to this service.
   * ctx.resolveAwakeable(awakeableIdentifier, "hello");
   */
  resolveAwakeable<T>(id: string, payload?: T, serde?: Serde<T>): void;

  /**
   * Reject an awakeable. When rejecting, the service waiting on this awakeable will be woken up with a terminal error with the provided reason.
   * @param id the string ID of the awakeable.
   * This is supplied by the service that needs to be woken up.
   * @param reason the reason of the rejection.
   *
   * @example
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
   * const service = restate.service(
   *   name: "myservice",
   *   handlers: {
   *    someAction:    async(ctx: restate.Context, req: string) => { ... },
   *    anotherAction: async(ctx: restate.Context, count: number) => { ... }
   * });
   *
   * // option 1: export only the type signature
   * export type Service = typeof service;
   *
   *
   * restate.endpoint().bind(service).listen(9080);
   * ```
   * **Client side:**
   * ```ts
   * // option 1: use only types and supply service name separately
   * const result1 = await ctx.serviceClient<Service>({name: "myservice"}).someAction("hello!");
   *
   * // option 2: use full API spec
   * type MyService: Service = { name: "myservice" };
   * const result2 = await ctx.serviceClient(Service).anotherAction(1337);
   * ```
   */
  serviceClient<D>(opts: ServiceDefinitionFrom<D>): Client<Service<D>>;

  /**
   * Same as {@link serviceClient} but for virtual objects.
   *
   * @param opts
   * @param key the virtual object key
   */
  objectClient<D>(
    opts: VirtualObjectDefinitionFrom<D>,
    key: string
  ): Client<VirtualObject<D>>;

  /**
   * Same as {@link serviceClient} but for workflows.
   *
   * @param opts
   * @param key the workflow key
   */
  workflowClient<D>(
    opts: WorkflowDefinitionFrom<D>,
    key: string
  ): Client<Workflow<D>>;

  /**
   * Same as {@link objectSendClient} but for workflows.
   *
   * @param opts
   * @param key the workflow key
   */
  workflowSendClient<D>(
    opts: WorkflowDefinitionFrom<D>,
    key: string
  ): SendClient<Workflow<D>>;

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
   * const service = restate.service(
   *   name: "myservice",
   *   handlers: {
   *    someAction:    async(ctx: restate.Context, req: string) => { ... },
   *    anotherAction: async(ctx: restate.Context, count: number) => { ... }
   * });
   *
   * // option 1: export only the type signature of the router
   * export type MyApi = typeof service;
   *
   * // option 2: export the API definition with type and name (name)
   * const MyService: MyApi = { name: "myservice" };
   *
   * restate.endpoint().bind(service).listen(9080);
   * ```
   * **Client side:**
   * ```ts
   * // option 1: use only types and supply service name separately
   * ctx.serviceSendClient<MyApi>({name: "myservice"}).someAction("hello!");
   *
   * // option 2: use full API spec
   * ctx.serviceSendClient(MyService).anotherAction(1337);
   * ```
   */
  serviceSendClient<D>(
    service: ServiceDefinitionFrom<D>,
    opts?: SendOptions
  ): SendClient<Service<D>>;

  /**
   * Same as {@link serviceSendClient} but for virtual objects.
   *
   * @param obj
   * @param key the virtual object key
   * @param opts Send options
   */
  objectSendClient<D>(
    obj: VirtualObjectDefinitionFrom<D>,
    key: string,
    opts?: SendOptions
  ): SendClient<VirtualObject<D>>;

  genericCall<REQ = Uint8Array, RES = Uint8Array>(
    call: GenericCall<REQ, RES>
  ): InvocationPromise<RES>;

  genericSend<REQ = Uint8Array>(call: GenericSend<REQ>): InvocationHandle;

  /**
   * Returns the raw request that triggered that handler.
   * Use that object to inspect the original request headers
   */
  request(): Request;

  /**
   * Cancel an invocation
   *
   * @param invocationId the invocation id to cancel
   */
  cancel(invocationId: InvocationId): void;

  /**
   * Attach to an invocation
   *
   * @param invocationId the invocation id to attach to
   * @param serde the serde to use for the result, default to JSON serde.
   */
  attach<T>(
    invocationId: InvocationId,
    serde?: Serde<T>
  ): CombineablePromise<T>;
}

/**
 * The context that gives access to all Restate-backed operations, for example
 *   - sending reliable messages / RPC through Restate
 *   - access/update state
 *   - execute non-deterministic closures and memoize their result
 *   - sleeps and delayed calls
 *   - awakeables
 *   - ...
 *
 * This context can be used only within virtual objects.
 *
 */
export interface ObjectContext<TState extends TypedState = UntypedState>
  extends Context,
    KeyValueStore<TState>,
    RestateObjectContext {
  key: string;
}

/**
 * The context that gives access to all Restate-backed operations, for example
 *   - sending reliable messages / RPC through Restate
 *   - execute non-deterministic closures and memoize their result
 *   - sleeps and delayed calls
 *   - awakeables
 *   - ...
 *
 * This context can be used only within a shared virtual objects.
 *
 */
export interface ObjectSharedContext<TState extends TypedState = UntypedState>
  extends Context,
    RestateObjectSharedContext {
  key: string;

  /**
   * Get/retrieve state from the Restate runtime.
   * Note that state objects are serialized with `Buffer.from(JSON.stringify(theObject))`
   * and deserialized with `JSON.parse(value.toString()) as T`.
   *
   * @param name key of the state to retrieve
   * @returns a Promise that is resolved with the value of the state key
   *
   * @example
   * const state = await ctx.get<string>("STATE");
   */
  get<TValue, TKey extends keyof TState = string>(
    name: TState extends UntypedState ? string : TKey,
    serde?: Serde<TState extends UntypedState ? TValue : TState[TKey]>
  ): Promise<(TState extends UntypedState ? TValue : TState[TKey]) | null>;

  /**
   * Retrieve all the state keys for this object.
   */
  stateKeys(): Promise<Array<string>>;
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
  /**
   * Creates a promise that awaits for the current promise up to the specified timeout duration.
   * If the timeout is fired, this Promise will be rejected with a {@link TimeoutError}.
   *
   * @param millis duration of the sleep in millis.
   * This is a lower-bound.
   */
  orTimeout(millis: number): CombineablePromise<T>;
};

/**
 * Represents an invocation id.
 * @see {@link InvocationIdParser}
 */
export type InvocationId = string & { __brand: "InvocationId" };

export const InvocationIdParser = {
  /**
   * Creates an invocation id from a string.
   * @param id the string to use as invocation id.
   */
  fromString(id: string): InvocationId {
    if (!id.startsWith("inv")) {
      throw new Error(
        `Expected invocation id to start with 'inv' but got ${id}`
      );
    }
    return id as InvocationId;
  },
};

export type InvocationHandle = {
  // The invocation id of the call
  readonly invocationId: Promise<InvocationId>;
};

export type InvocationPromise<T> = CombineablePromise<T> & InvocationHandle;

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
  all<T extends readonly CombineablePromise<unknown>[]>(
    values: T
  ): CombineablePromise<{ -readonly [P in keyof T]: Awaited<T[P]> }> {
    if (values.length === 0) {
      throw new Error(
        "Expected combineable promise to have at least one promise"
      );
    }
    return ContextImpl.createCombinator(
      (p) => Promise.all(p),
      values
    ) as CombineablePromise<{
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
  race<T extends readonly CombineablePromise<unknown>[]>(
    values: T
  ): CombineablePromise<Awaited<T[number]>> {
    if (values.length === 0) {
      throw new Error(
        "Expected combineable promise to have at least one promise"
      );
    }
    return ContextImpl.createCombinator(
      (p) => Promise.race(p),
      values
    ) as CombineablePromise<Awaited<T[number]>>;
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
  any<T extends readonly CombineablePromise<unknown>[]>(
    values: T
  ): CombineablePromise<Awaited<T[number]>> {
    if (values.length === 0) {
      throw new Error(
        "Expected combineable promise to have at least one promise"
      );
    }
    return ContextImpl.createCombinator(
      (p) => Promise.any(p),
      values
    ) as CombineablePromise<Awaited<T[number]>>;
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
  allSettled<T extends readonly CombineablePromise<unknown>[]>(
    values: T
  ): CombineablePromise<{
    -readonly [P in keyof T]: PromiseSettledResult<Awaited<T[P]>>;
  }> {
    if (values.length === 0) {
      throw new Error(
        "Expected combineable promise to have at least one promise"
      );
    }
    return ContextImpl.createCombinator(
      (p) => Promise.allSettled(p),
      values
    ) as CombineablePromise<{
      -readonly [P in keyof T]: PromiseSettledResult<Awaited<T[P]>>;
    }>;
  },
};

/**
 * Workflow bound durable promise
 *
 * See {@link WorkflowSharedContext} promise..
 */
export type DurablePromise<T> = Promise<T> & {
  /**
   * Returns the value of the promise, if it has been resolved.
   */
  peek(): Promise<T | undefined>;

  /**
   * Resolve the promise with the given value.
   * @param value the value to resolve the promise with
   */
  resolve(value?: T): Promise<void>;

  /**
   * Reject the promise with the given error message.
   * @param errorMsg the error message to use for rejection.
   */
  reject(errorMsg: string): Promise<void>;

  /**
   * Obtain a {@link CombineablePromise} variant of this promise.
   */
  get(): CombineablePromise<T>;
};

export interface WorkflowSharedContext<TState extends TypedState = UntypedState>
  extends ObjectSharedContext<TState>,
    RestateWorkflowSharedContext {
  /**
   * Create a durable promise that can be resolved or rejected during the workflow execution.
   * The promise is bound to the workflow and will be persisted across suspensions and retries.
   *
   * @example
   * ```ts
   *        const wf = restate.workflow({
   *              name: "myWorkflow",
   *              handlers: {
   *                 run: async (ctx: restate.WorkflowContext) => {
   *                        // ... do some work ...
   *                        const payment = await ctx.promise<Payment>("payment.succeeded");
   *                         // ... do some more work ...
   *                },
   *
   *                onPaymentSucceeded: async (ctx: restate.WorkflowContext, payment) => {
   *                       // ... handle payment succeeded ...
   *                        await ctx.promise("payment.succeeded").resolve(payment);
   *                }
   *      });
   *  ```
   *
   * @param name the name of the durable promise
   */
  promise<T>(name: string, serde?: Serde<T>): DurablePromise<T>;
}

export interface WorkflowContext<TState extends TypedState = UntypedState>
  extends WorkflowSharedContext<TState>,
    ObjectContext<TState>,
    RestateWorkflowContext {}
