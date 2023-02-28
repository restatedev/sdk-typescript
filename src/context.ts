"use strict";

export interface RestateContext {
  request(
    service: string,
    method: string,
    data: Uint8Array
  ): Promise<Uint8Array>;

  getState(name: string): Promise<Uint8Array>;

  setState(name: string, value: Uint8Array): Promise<void>;
}

export class GrpcRestateContext implements RestateContext {
  async getState(name: string): Promise<Uint8Array> {
    return new Uint8Array(0);
  }

  async setState(name: string, value: Uint8Array): Promise<void> {
    // nothing
  }

  request(
    service: string,
    method: string,
    data: Uint8Array
  ): Promise<Uint8Array> {
    // restae call
    return Promise.resolve(new Uint8Array(0));
  }
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
  Object.assign(wrapper, instance);
  return wrapper as T;
}
