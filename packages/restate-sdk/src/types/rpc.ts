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
import {
  CombineablePromise,
  Context,
  ObjectContext,
  ObjectSharedContext,
  WorkflowContext,
  WorkflowSharedContext,
} from "../context";
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
  WorkflowHandler,
  WorkflowDefinition,
  Workflow,
  WorkflowSharedHandler,
} from "@restatedev/restate-sdk-core";

// ----------- rpc clients -------------------------------------------------------

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

// ----------- handlers ----------------------------------------------

export enum HandlerKind {
  SERVICE,
  EXCLUSIVE,
  SHARED,
  WORKFLOW,
}

export type ServiceHandlerOpts = {
  accept?: string;
  contentType?: string;
  inputDeserializer?: <T>(input: Uint8Array) => T | undefined;
  outputSerializer?: <T>(output: T | undefined) => Uint8Array;
};

export type ObjectHandlerOpts = {
  accept?: string;
  contentType?: string;
  inputDeserializer?: <T>(input: Uint8Array) => T | undefined;
  outputSerializer?: <T>(output: T | undefined) => Uint8Array;
};

export type WorkflowHandlerOpts = {
  accept?: string;
  contentType?: string;
  inputDeserializer?: <T>(input: Uint8Array) => T | undefined;
  outputSerializer?: <T>(output: T | undefined) => Uint8Array;
};

const JSON_CONTENT_TYPE = "application/json";
const HANDLER_SYMBOL = Symbol("Handler");

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
    return handler[HANDLER_SYMBOL];
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
    const existing = HandlerWrapper.fromHandler(handler);
    if (existing !== undefined) {
      return handler as F;
    }
    Object.defineProperty(handler, HANDLER_SYMBOL, { value: this });
    return handler as F;
  }
}

// ----------- handler decorators ----------------------------------------------

export namespace handlers {
  /**
   * Create a service handler.
   *
   * @param opts additional configuration
   * @param fn the actual handler code to execute
   */
  export function handler<F>(
    opts: ServiceHandlerOpts,
    fn: ServiceHandler<F, Context>
  ): F {
    return HandlerWrapper.from(HandlerKind.SERVICE, fn, opts).transpose();
  }

  export namespace workflow {
    export function workflow<F>(
      opts: WorkflowHandlerOpts,
      fn: WorkflowHandler<F, WorkflowContext>
    ): F;

    export function workflow<F>(fn: WorkflowHandler<F, WorkflowContext>): F;

    export function workflow<F>(
      optsOrFn: WorkflowHandlerOpts | WorkflowHandler<F, WorkflowContext>,
      fn?: WorkflowHandler<F, WorkflowContext>
    ): F {
      if (typeof optsOrFn == "function") {
        return HandlerWrapper.from(HandlerKind.WORKFLOW, optsOrFn).transpose();
      }
      const opts = optsOrFn satisfies WorkflowHandlerOpts;
      if (typeof fn !== "function") {
        throw new TypeError("The second argument must be a function");
      }
      return HandlerWrapper.from(HandlerKind.WORKFLOW, fn, opts).transpose();
    }

    /**
     * Creates a shared handler for a workflow.
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
      opts: WorkflowHandlerOpts,
      fn: WorkflowSharedHandler<F, WorkflowSharedContext>
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
    export function shared<F>(
      fn: WorkflowSharedHandler<F, WorkflowSharedContext>
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
    export function shared<F>(
      optsOrFn:
        | WorkflowHandlerOpts
        | WorkflowSharedHandler<F, WorkflowSharedContext>,
      fn?: WorkflowSharedHandler<F, WorkflowSharedContext>
    ): F {
      if (typeof optsOrFn == "function") {
        return HandlerWrapper.from(HandlerKind.SHARED, optsOrFn).transpose();
      }
      const opts = optsOrFn satisfies ObjectHandlerOpts;
      if (typeof fn !== "function") {
        throw new TypeError("The second argument must be a function");
      }
      return HandlerWrapper.from(HandlerKind.SHARED, fn, opts).transpose();
    }
  }

  export namespace object {
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
      fn: ObjectHandler<F, ObjectContext>
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
    export function exclusive<F>(fn: ObjectHandler<F, ObjectContext>): F;

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
      optsOrFn: ObjectHandlerOpts | ObjectHandler<F, ObjectContext>,
      fn?: ObjectHandler<F, ObjectContext>
    ): F {
      if (typeof optsOrFn == "function") {
        return HandlerWrapper.from(HandlerKind.EXCLUSIVE, optsOrFn).transpose();
      }
      const opts = optsOrFn satisfies ObjectHandlerOpts;
      if (typeof fn !== "function") {
        throw new TypeError("The second argument must be a function");
      }
      return HandlerWrapper.from(HandlerKind.EXCLUSIVE, fn, opts).transpose();
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
      fn: ObjectSharedHandler<F, ObjectSharedContext>
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
    export function shared<F>(
      fn: ObjectSharedHandler<F, ObjectSharedContext>
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
    export function shared<F>(
      optsOrFn: ObjectHandlerOpts | ObjectSharedHandler<F, ObjectSharedContext>,
      fn?: ObjectSharedHandler<F, ObjectSharedContext>
    ): F {
      if (typeof optsOrFn == "function") {
        return HandlerWrapper.from(HandlerKind.SHARED, optsOrFn).transpose();
      }
      const opts = optsOrFn satisfies ObjectHandlerOpts;
      if (typeof fn !== "function") {
        throw new TypeError("The second argument must be a function");
      }
      return HandlerWrapper.from(HandlerKind.SHARED, fn, opts).transpose();
    }
  }
}

// ----------- services ----------------------------------------------

export type ServiceOpts<U> = {
  [K in keyof U]: U[K] extends ServiceHandler<any, Context> ? U[K] : never;
};

/**
 * Define a Restate service.
 *
 * @param service
 */
export const service = <P extends string, M>(service: {
  name: P;
  handlers: ServiceOpts<M>;
}): ServiceDefinition<P, Service<M, Context>> => {
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

// ----------- objects ----------------------------------------------

export type ObjectOpts<U> = {
  [K in keyof U]: U[K] extends ObjectHandler<U[K], ObjectContext>
    ? U[K]
    : U[K] extends ObjectHandler<U[K], ObjectSharedContext>
    ? U[K]
    : never;
};

/**
 * Define a Restate virtual object.
 *
 * @param object
 */
export const object = <P extends string, M>(object: {
  name: P;
  handlers: ObjectOpts<M>;
}): VirtualObjectDefinition<
  P,
  VirtualObject<M, ObjectContext, ObjectSharedContext>
> => {
  if (!object.handlers) {
    throw new Error("object options must be defined");
  }

  const handlers = Object.entries(object.handlers).map(([name, handler]) => {
    if (handler instanceof Function) {
      if (HandlerWrapper.fromHandler(handler) !== undefined) {
        return [name, handler];
      }

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

// ----------- workflows ----------------------------------------------

export type WorkflowOpts<U> = {
  run: (ctx: WorkflowContext, argument: any) => Promise<any>;
} & {
  [K in keyof U]: K extends
    | "workflowSubmit"
    | "workflowAttach"
    | "workflowOutput"
    ? `${K} is a reserved keyword`
    : K extends "run"
    ? U[K] extends WorkflowHandler<U[K], WorkflowContext>
      ? U[K]
      : "An handler named 'run' must take as a first argument a WorkflowContext, and must return a Promise"
    : U[K] extends WorkflowSharedHandler<U[K], WorkflowSharedContext>
    ? U[K]
    : "An handler other then 'run' must accept as a first argument a WorkflowSharedContext";
};

/**
 * Define a Restate virtual object.
 *
 * @param workflow
 */
export const workflow = <P extends string, M>(workflow: {
  name: P;
  handlers: WorkflowOpts<M>;
}): WorkflowDefinition<
  P,
  Workflow<M, WorkflowContext, WorkflowSharedContext>
> => {
  if (!workflow.handlers) {
    throw new Error("workflow must contain handlers");
  }

  //
  // Add the main 'run' handler
  //
  const runHandler = workflow.handlers["run"];
  let runWrapper: HandlerWrapper;

  if (runHandler instanceof HandlerWrapper) {
    runWrapper = runHandler;
  } else if (runHandler instanceof Function) {
    runWrapper =
      HandlerWrapper.fromHandler(runHandler) ??
      HandlerWrapper.from(HandlerKind.WORKFLOW, runHandler);
  } else {
    throw new TypeError(`Missing main workflow handler, named 'run'`);
  }
  if (runWrapper.kind != HandlerKind.WORKFLOW) {
    throw new TypeError(
      `Workflow's main handler handler run, must be of type workflow'`
    );
  }

  const handlers = [["run", runWrapper.transpose()]];

  //
  // Add all the shared handlers now
  //

  for (const [name, handler] of Object.entries(workflow.handlers)) {
    if (name == "run") {
      continue;
    }
    let wrapper: HandlerWrapper;

    if (handler instanceof HandlerWrapper) {
      wrapper = handler;
    } else if (handler instanceof Function) {
      wrapper =
        HandlerWrapper.fromHandler(handler) ??
        HandlerWrapper.from(HandlerKind.SHARED, handler);
    } else {
      throw new TypeError(`Unexpected handler type ${name}`);
    }
    if (wrapper.kind == HandlerKind.WORKFLOW) {
      throw new TypeError(
        `A workflow must contain exactly one handler annotated as workflow, named 'run'. Please use a shared handler for any additional handlers`
      );
    }
    handlers.push([name, wrapper.transpose()]);
  }

  return {
    name: workflow.name,
    workflow: Object.fromEntries(handlers) as Workflow<M>,
  };
};
