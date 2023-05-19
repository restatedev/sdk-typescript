"use strict";

// Use our prefixed logger instead of default console logging
import "./utils/logger";

export interface RestateContext {
  /**
   * Id of the service instance.
   */
  instanceKey: Buffer;
  /**
   * Name of the service.
   */
  serviceName: string;
  /**
   * Id of the ongoing invocation.
   */
  invocationId: Buffer;

  /**
   * Get/retrieve state from the Restate runtime.
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
   * Call other Restate services in the background ( = async / not waiting on response).
   * To do this, wrap the call via the proto-ts client with inBackground, as shown in the example.
   *
   * NOTE: this returns a Promise because we override the gRPC clients provided by proto-ts.
   * So we are required to return a Promise.
   *
   * @param call Invoke another service by using the generated proto-ts client.
   *
   * @example
   * const ctx = restate.useContext(this);
   * const client = new GreeterClientImpl(ctx);
   * await ctx.inBackground(() =>
   *   client.greet(Request.create({ name: "Peter" }))
   * )
   */
  inBackground<T>(call: () => Promise<T>, delayMillis?: number): void;

  /**
   * Execute a side effect and store the result in the Restate runtime.
   * @param fn user-defined function to execute.
   * The result is saved in the Restate runtime and reused on replays.
   * @returns a Promise that gets resolved with the result of the user-defined function,
   * once it has been saved in the Restate runtime.
   *
   * @example
   * const ctx = restate.useContext(this);
   * const result = await ctx.sideEffect<string>(async () => { return doSomething(); })
   */
  sideEffect<T>(fn: () => Promise<T>): Promise<T>;

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
   * Synchronously call other Restate services ( = wait on response).
   * It is not recommended to use this.
   * It is recommended
   * to do the request via the proto-ts client that was generated based on the Protobuf service definitions,
   * as shown in the example.
   * These clients use this request method under-the-hood.
   * @param service name of the service to call
   * @param method name of the method to call
   * @param data payload as Uint8Array
   * @returns a Promise that is resolved with the response of the called service
   *

   * @example
   * const ctx = restate.useContext(this);
   * const client = new GreeterClientImpl(ctx);
   * client.greet(Request.create({ name: "Peter" }))
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
