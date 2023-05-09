"use strict";

import { AwakeableIdentifier } from "./types/protocol";

// Use our prefixed logger instead of default console logging
import "./utils/logger";

export interface RestateContext {
  instanceKey: Buffer;
  serviceName: string;
  invocationId: Buffer;

  request(
    service: string,
    method: string,
    data: Uint8Array
  ): Promise<Uint8Array>;

  get<T>(name: string): Promise<T | null>;

  set<T>(name: string, value: T): void;

  clear(name: string): void;

  /**
   * Use this to call other Restate services in the background ( = async / not waiting on response).
   * To do this, wrap the call via the proto-ts client with inBackground, as shown in the example below.
   *
   * NOTE: this returns a Promise because we override the gRPC clients provided by proto-ts.
   * So we are required to return a Promise.
   *
   * @param call Invoke another service by using the generated proto-ts client.
   *
   * @example
   *     const client = new GreeterClientImpl(ctx);
   *     await ctx.inBackground(() =>
   *       client.greet(Request.create({ name: "Peter" }))
   *     );
   *
   */
  inBackground<T>(call: () => Promise<T>): Promise<void>;

  sideEffect<T>(fn: () => Promise<T>): Promise<T>;

  awakeable<T>(): Promise<T>;

  completeAwakeable<T>(id: AwakeableIdentifier, payload: T): void;

  sleep(millis: number): Promise<void>;
}

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
