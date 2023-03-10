"use strict";

import { AwakeableIdentifier } from "./types";

export interface RestateContext {
  request(
    service: string,
    method: string,
    data: Uint8Array
  ): Promise<Uint8Array>;

  get<T>(name: string): Promise<T | null>;

  set<T>(name: string, value: T): Promise<void>;

  clear(name: string): Promise<void>;

  inBackground<T>(call: () => Promise<T>): Promise<void>;
  
  sideEffect<T>(fn: () => Promise<T>): Promise<T>;

  awakeable<T>(): Promise<T>;

  completeAwakeable<T>(id: AwakeableIdentifier, payload: T): Promise<void>;

  sleep(millis: number): Promise<void>; 
}

export function useContext<T>(instance: T): RestateContext {
  const wrapper = instance as ThisMethodWrapper;
  if (wrapper.$$restate === undefined || wrapper.$$restate === null) {
    throw new Error(`not running within a Restate call.`);
  }
  return wrapper.$$restate;
}

class ThisMethodWrapper {
  constructor(readonly $$restate: RestateContext) {}
}

export function setContext<T>(instance: T, context: RestateContext): T {
  // internal:
  // creates a *new*, per call object that shares all the properties that @instance has
  // except '$$restate' which is a unique, per call pointer to a restate context.
  const wrapper = new ThisMethodWrapper(context);
  // TODO: figure out if there is a more robust way to achieve that.
  // see here for example
  // https://itnext.io/hidden-properties-in-javascript-73b52def1589
  Object.assign(wrapper, instance);
  return wrapper as T;
}