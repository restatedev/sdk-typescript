"use strict";

export interface RestateContext {
  request(
    service: string,
    method: string,
    data: Uint8Array
  ): Promise<Uint8Array>;

  getState<T>(name: string): Promise<T | null>;

  setState<T>(name: string, value: T): Promise<void>;
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
