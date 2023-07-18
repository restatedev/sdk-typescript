"use strict";

// Use our prefixed logger instead of default console logging
import "./utils/logger";
import { RetrySettings } from "./utils/public_utils";

export interface RestateContext {
  /**
   * The key associated with the current function invocation.
   *
   * For keyed services, this is the key extracted from the input argument, as annotated in the
   * protobuf service definition.
   *
   * For unkeyed services, this is the internal key under which restate stores the journal and
   * transient state of the function execution.
   */
  instanceKey: Buffer;

  /**
   * Name of the service.
   */
  serviceName: string;

  /**
   * The unique id that identifies the current function invocation. This id is guaranteed to be
   * unique across invocations, but constant across reties and suspensions.
   */
  invocationId: Buffer;

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
   * const state = ctx.set("STATE", "Hello");
   */
  set<T>(name: string, value: T): void;

  /**
   * Clear/delete state in the Restate runtime.
   * @param name key of the state to delete
   *
   * @example
   * const ctx = restate.useContext(this);
   * const state = ctx.clear("STATE");
   */
  clear(name: string): void;

  /**
   * Unidirectional call to other Restate services ( = in background / async / not waiting on response).
   * To do this, wrap the call via the proto-ts client with oneWayCall, as shown in the example.
   *
   * NOTE: this returns a Promise because we override the gRPC clients provided by proto-ts.
   * So we are required to return a Promise.
   *
   * @param call Invoke another service by using the generated proto-ts client.
   * @example
   * const ctx = restate.useContext(this);
   * const client = new GreeterClientImpl(ctx);
   * await ctx.oneWayCall(() =>
   *   client.greet(Request.create({ name: "Peter" }))
   * )
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  oneWayCall(call: () => Promise<any>): Promise<void>;

  /**
   * Delayed unidirectional call to other Restate services ( = in background / async / not waiting on response).
   * To do this, wrap the call via the proto-ts client with delayedCall, as shown in the example.
   * Add the delay in millis as the second parameter.
   *
   * NOTE: this returns a Promise because we override the gRPC clients provided by proto-ts.
   * So we are required to return a Promise.
   *
   * @param call Invoke another service by using the generated proto-ts client.
   * @param delayMillis millisecond delay duration to delay the execution of the call
   * @example
   * const ctx = restate.useContext(this);
   * const client = new GreeterClientImpl(ctx);
   * await ctx.delayedCall(() =>
   *   client.greet(Request.create({ name: "Peter" })),
   *   5000
   * )
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delayedCall(call: () => Promise<any>, delayMillis?: number): Promise<void>;

  /**
   * Executes a side effect and stores the result in the Restate runtime.
   *
   * Failing side effects are retried as follows:
   * - When a TerminalError is thrown: no retries (not by runtime and also not when supplying retrySettings)
   * - For all other error types:
   *      - By default, the runtime will do infinite invocation retries
   *      - When you supply retrySettings: the side effect will be retried within the process according to the supplied retry settings.
   *      So you don't go through an entire invocation retry, but the retry is immediately triggered by the SDK.
   *
   * If retry settings are supplied, the call is retried on failure with a timed backoff.
   * The side effect function is retried when it throws an Error, until returns a successfully
   * resolved Promise. Between retries, this function will do a suspendable Restate sleep.
   * The sleep time starts with the 'initialDelayMs' value and doubles on each retry, up to
   * a maximum of maxDelayMs.
   *
   * The returned Promise will be resolved successfully once the side effect action completes
   * successfully and will be rejected with an error if the maximum number of retries
   * (as specified by 'maxRetries') is exhausted.
   * @param fn The side effect action to run.
   * The result is saved in the Restate runtime and reused on replays.
   * @param retrySettings Settings for the retries, like delay, attempts, etc.
   * @returns a Promise that gets resolved with the result of the user-defined function,
   * once it has been saved in the Restate runtime. If retry settings have been supplied,
   * the promise is resolved successfully when the side effect has completed,
   * and rejected if the retries are exhausted.
   *
   * @example
   * const ctx = restate.useContext(this);
   * const result = await ctx.sideEffect<string>(async () => { return doSomething(); })
   * const result = await ctx.sideEffect<string>(async () => { return doSomething(); }, {initialDelayMs: 1000, maxRetries: 10})
   */
  sideEffect<T>(fn: () => Promise<T>, retrySettings?: RetrySettings): Promise<T>;

  /**
   * Register an awakeable and pause the processing until the awakeable ID has been returned to the service
   * (via ctx.completeAwakeable(...)).
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
  awakeable<T>(): { id: string; promise: Promise<T> };

  /**
   * Complete an awakeable of another service.
   * @param id the string ID of the awakeable.
   * This is supplied by the service that needs to be woken up.
   * @param payload the payload to pass to the service that is woken up
   *
   * @example
   * const ctx = restate.useContext(this);
   * // The sleeping service should have sent the awakeableIdentifier string to this service.
   * ctx.completeAwakeable(awakeableIdentifier, "hello");
   */
  completeAwakeable<T>(id: string, payload: T): void;

  /**
   * Sleep until a timeout has passed.
   * @param millis duration of the sleep in millis.
   * This is a lower-bound.
   *
   * @example
   * const ctx = restate.useContext(this);
   * await ctx.sleep(1000);
   */
  sleep(millis: number): Promise<void>;

  /**
   * Call another Restate service and await the response.
   *
   * This function is not recommended to be called directly. Instead, use the generated gRPC client
   * that was generated based on the Protobuf service definitions (which internally use this method):
   *
   * @example
   * ```
   * const ctx = restate.useContext(this);
   * const client = new GreeterClientImpl(ctx);
   * client.greet(Request.create({ name: "Peter" }))
   * ```
   *
   * @param service name of the service to call
   * @param method name of the method to call
   * @param data payload as Uint8Array
   * @returns a Promise that is resolved with the response of the called service
   */
  request(
    service: string,
    method: string,
    data: Uint8Array
  ): Promise<Uint8Array>;
}

/**
 * Returns the RestateContext which is the entrypoint for all interaction with Restate.
 * Use this from within a method to retrieve the RestateContext.
 * The context is bounded to a single invocation.
 *
 * @example
 * const ctx = restate.useContext(this);
 *
 */
export function useContext<T>(instance: T): RestateContext {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wrapper = instance as any;
  if (wrapper.$$restate === undefined || wrapper.$$restate === null) {
    throw new Error(`not running within a Restate call.`);
  }
  return wrapper.$$restate;
}

export function setContext<T>(instance: T, context: RestateContext): T {
  // creates a *new*, per call object that shares all the properties that @instance has
  // except '$$restate' which is a unique, per call pointer to a restate context.
  //
  // The following line create a new object, that its prototype is @instance.
  // and that object has a $$restate property.
  const wrapper = Object.create(instance as object, {
    $$restate: { value: context },
  });
  return wrapper as T;
}
