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
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/ban-types */
import { CombineablePromise } from "../context";
import {
  deserializeJson,
  deserializeNoop,
  serializeJson,
  serializeNoop,
} from "../utils/serde";

import {
  ServiceHandler,
  Service,
  ServiceDefinition,
  ObjectHandler,
  ObjectSharedHandler,
  VirtualObjectDefinition,
  VirtualObject,
} from "@restatedev/restate-sdk-core";

// ----------- generics -------------------------------------------------------

export type Client<M> = {
  [K in keyof M as M[K] extends never ? never : K]: M[K] extends (
    ...args: infer P
  ) => PromiseLike<infer O>
    ? (...args: P) => CombineablePromise<O>
    : never;
};

export type SendClient<M> = {
  [K in keyof M as M[K] extends never ? never : K]: M[K] extends (
    ...args: infer P
  ) => any
    ? (...args: P) => void
    : never;
};

// ----------- unkeyed handlers ----------------------------------------------

export type ServiceOpts<U> = {
  [K in keyof U]: U[K] extends ServiceHandler<any> ? U[K] : never;
};

/**
 * Define a Restate service.
 *
 * @param service
 */
export const service = <P extends string, M>(service: {
  name: P;
  handlers: ServiceOpts<M>;
}): ServiceDefinition<P, Service<M>> => {
  if (!service.handlers) {
    throw new Error("service must be defined");
  }
  const handlers = Object.entries(service.handlers).map(([name, handler]) => {
    if (handler instanceof HandlerWrapper) {
      return [name, handler.transpose()];
    }
    if (handler instanceof Function) {
      return [
        name,
        HandlerWrapper.from(HandlerKind.SERVICE, handler).transpose(),
      ];
    }
    throw new TypeError(`Unexpected handler type ${name}`);
  });

  return {
    name: service.name,
    service: Object.fromEntries(handlers) as Service<M>,
  };
};

// ----------- object handlers ----------------------------------------------

export type ObjectHandlerOpts = {
  accept?: string;
  contentType?: string;
  inputDeserializer?: <T>(input: Uint8Array) => T | undefined;
  outputSerializer?: <T>(output: T | undefined) => Uint8Array;
};

export type ServiceHandlerOpts = {
  accept?: string;
  contentType?: string;
  inputDeserializer?: <T>(input: Uint8Array) => T | undefined;
  outputSerializer?: <T>(output: T | undefined) => Uint8Array;
};

export enum HandlerKind {
  EXCLUSIVE,
  SHARED,
  WORKFLOW,
  SERVICE,
}

const JSON_CONTENT_TYPE = "application/json";

export class HandlerWrapper {
  public static from(
    kind: HandlerKind,
    handler: Function,
    opts?: ServiceHandlerOpts | ObjectHandlerOpts
  ): HandlerWrapper {
    const input = opts?.accept ?? JSON_CONTENT_TYPE;
    const output = opts?.contentType ?? JSON_CONTENT_TYPE;

    const deserializer =
      opts?.inputDeserializer ??
      (input.toLocaleLowerCase() == JSON_CONTENT_TYPE
        ? deserializeJson
        : deserializeNoop);

    const serializer =
      opts?.outputSerializer ??
      (output.toLocaleLowerCase() == JSON_CONTENT_TYPE
        ? serializeJson
        : serializeNoop);

    // we must create here a copy of the handler
    // to be able to reuse the original handler in other places.
    // like for example the same logic but under different routes.
    const handlerCopy = function (this: any, ...args: any[]) {
      return handler.apply(this, args);
    };

    return new HandlerWrapper(
      kind,
      handlerCopy,
      input,
      output,
      deserializer,
      serializer
    );
  }

  public static fromHandler(handler: any): HandlerWrapper | undefined {
    const wrapper = handler[HANDLER_SYMBOL];
    if (wrapper instanceof HandlerWrapper) {
      return wrapper;
    }
    return undefined;
  }

  private constructor(
    public readonly kind: HandlerKind,
    private handler: Function,
    public readonly accept: string,
    public readonly contentType: string,
    public readonly deserializer: (input: Uint8Array) => unknown,
    public readonly serializer: (input: unknown) => Uint8Array
  ) {}

  bindInstance(t: unknown) {
    this.handler = this.handler.bind(t);
  }

  async invoke(context: unknown, input: Uint8Array) {
    const req = this.deserializer(input);
    const res = await this.handler(context, req);
    return this.serializer(res);
  }

  /**
   * Instead of a HandlerWrapper with a handler property,
   * return the original handler with a HandlerWrapper property.
   * This is needed to keep the appearance of regular functions
   * bound to an object, so that for example, `this.foo(ctx, arg)` would
   * work.
   */
  transpose<F>(): F {
    const handler = this.handler;
    defineProperty(handler, HANDLER_SYMBOL, this);
    return handler as F;
  }
}

// wraps defineProperty such that it informs tsc of the correct type of its output
function defineProperty<Obj extends object, Key extends PropertyKey, T>(
  obj: Obj,
  prop: Key,
  value: T
): asserts obj is Obj & Readonly<Record<Key, T>> {
  Object.defineProperty(obj, prop, { value });
}
const HANDLER_SYMBOL = Symbol("Handler");

export namespace handlers {
  /**
   * Create a service handler.
   *
   * @param opts additional configuration
   * @param fn the actual handler code to execute
   */
  export function handler<F>(
    opts: ServiceHandlerOpts,
    fn: ServiceHandler<F>
  ): F {
    return HandlerWrapper.from(HandlerKind.SERVICE, fn, opts) as F;
  }

  /**
   * Creates an exclusive handler for a virtual Object.
   *
   * note : This applies only to a virtual object.
   *
   * @param opts additional configurations
   * @param fn the handler to execute
   */
  export function exclusive<F>(
    opts: ObjectHandlerOpts,
    fn: ObjectHandler<F>
  ): F;

  /**
   * Creates an exclusive handler for a virtual Object.
   *
   *
   * note 1: This applies only to a virtual object.
   * note 2: This is the default for virtual objects, so if no
   *         additional reconfiguration is needed, you can simply
   *         use the handler directly (no need to use exclusive).
   *         This variant here is only for symmetry/convenance.
   *
   * @param fn the handler to execute
   */
  export function exclusive<F>(fn: ObjectHandler<F>): F;

  /**
   * Creates an exclusive handler for a virtual Object.
   *
   *
   * note 1: This applies only to a virtual object.
   * note 2: This is the default for virtual objects, so if no
   *         additional reconfiguration is needed, you can simply
   *         use the handler directly (no need to use exclusive).
   *         This variant here is only for symmetry/convenance.
   *
   * @param opts additional configurations
   * @param fn the handler to execute
   */
  export function exclusive<F>(
    optsOrFn: ObjectHandlerOpts | ObjectHandler<F>,
    fn?: ObjectHandler<F>
  ): F {
    if (typeof optsOrFn == "function") {
      return HandlerWrapper.from(HandlerKind.EXCLUSIVE, optsOrFn) as F;
    }
    const opts = optsOrFn satisfies ObjectHandlerOpts;
    if (typeof fn !== "function") {
      throw new TypeError("The second argument must be a function");
    }
    return HandlerWrapper.from(HandlerKind.EXCLUSIVE, fn, opts) as F;
  }

  /**
   * Creates a shared handler for a virtual Object.
   *
   * A shared handler allows a read-only concurrent execution
   * for a given key.
   *
   * note: This applies only to a virtual object.
   *
   * @param opts additional configurations
   * @param fn the handler to execute
   */
  export function shared<F>(
    opts: ObjectHandlerOpts,
    fn: ObjectSharedHandler<F>
  ): F;

  /**
   * Creates a shared handler for a virtual Object.
   *
   * A shared handler allows a read-only concurrent execution
   * for a given key.
   *
   * note: This applies only to a virtual object.
   *
   * @param opts additional configurations
   * @param fn the handler to execute
   */
  export function shared<F>(fn: ObjectSharedHandler<F>): F;

  /**
   * Creates a shared handler for a virtual Object.
   *
   * A shared handler allows a read-only concurrent execution
   * for a given key.
   *
   * note: This applies only to a virtual object.
   *
   * @param opts additional configurations
   * @param fn the handler to execute
   */
  export function shared<F>(
    optsOrFn: ObjectHandlerOpts | ObjectSharedHandler<F>,
    fn?: ObjectSharedHandler<F>
  ): F {
    if (typeof optsOrFn == "function") {
      return HandlerWrapper.from(HandlerKind.SHARED, optsOrFn) as F;
    }
    const opts = optsOrFn satisfies ObjectHandlerOpts;
    if (typeof fn !== "function") {
      throw new TypeError("The second argument must be a function");
    }
    return HandlerWrapper.from(HandlerKind.SHARED, fn, opts) as F;
  }
}

export type ObjectOpts<U> = {
  [K in keyof U]: U[K] extends ObjectHandler<U[K]> ? U[K] : never;
};

/**
 * Define a Restate virtual object.
 *
 * @param object
 */
export const object = <P extends string, M>(object: {
  name: P;
  handlers: ObjectOpts<M>;
}): VirtualObjectDefinition<P, VirtualObject<M>> => {
  if (!object.handlers) {
    throw new Error("object options must be defined");
  }

  const handlers = Object.entries(object.handlers).map(([name, handler]) => {
    if (handler instanceof HandlerWrapper) {
      return [name, handler.transpose()];
    }
    if (handler instanceof Function) {
      return [
        name,
        HandlerWrapper.from(HandlerKind.EXCLUSIVE, handler).transpose(),
      ];
    }
    throw new TypeError(`Unexpected handler type ${name}`);
  });

  return {
    name: object.name,
    object: Object.fromEntries(handlers) as VirtualObject<M>,
  };
};
