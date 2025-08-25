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
import type {
  Context,
  GenericCall,
  GenericSend,
  InvocationHandle,
  InvocationPromise,
  ObjectContext,
  ObjectSharedContext,
  TypedState,
  UntypedState,
  WorkflowContext,
  WorkflowSharedContext,
} from "../context.js";

import {
  type ServiceDefinition,
  type VirtualObjectDefinition,
  type WorkflowDefinition,
  type Serde,
  type Duration,
  serde,
} from "@restatedev/restate-sdk-core";
import { ensureError, TerminalError } from "./errors.js";

// ----------- rpc clients -------------------------------------------------------

export type ClientCallOptions<I, O> = {
  input?: Serde<I>;
  output?: Serde<O>;
  headers?: Record<string, string>;
  idempotencyKey?: string;
};

export class Opts<I, O> {
  /**
   * Create a call configuration from the provided options.
   *
   * @param opts the call configuration
   */
  public static from<I, O>(opts: ClientCallOptions<I, O>): Opts<I, O> {
    return new Opts<I, O>(opts);
  }

  private constructor(private readonly opts: ClientCallOptions<I, O>) {}

  public getOpts(): ClientCallOptions<I, O> {
    return this.opts;
  }
}

export type ClientSendOptions<I> = {
  input?: Serde<I>;
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
   * ctx.serviceSendClient(Service).anotherAction(1337, { delay: { seconds: 60 } });
   * ```
   */
  delay?: Duration | number;
  headers?: Record<string, string>;
  idempotencyKey?: string;
};

export class SendOpts<I> {
  public static from<I>(opts: ClientSendOptions<I>): SendOpts<I> {
    return new SendOpts<I>(opts);
  }

  public getOpts(): ClientSendOptions<I> {
    return this.opts;
  }

  private constructor(private readonly opts: ClientSendOptions<I>) {}
}

export namespace rpc {
  export const opts = <I, O>(opts: ClientCallOptions<I, O>) => Opts.from(opts);

  export const sendOpts = <I>(opts: ClientSendOptions<I>) =>
    SendOpts.from(opts);
}

function optsFromArgs(args: unknown[]): {
  parameter?: unknown;
  opts?:
    | ClientCallOptions<unknown, unknown>
    | ClientSendOptions<unknown>
    | undefined;
} {
  let parameter: unknown;
  let opts:
    | ClientCallOptions<unknown, unknown>
    | ClientSendOptions<unknown>
    | undefined;
  switch (args.length) {
    case 0: {
      break;
    }
    case 1: {
      if (args[0] instanceof Opts) {
        opts = args[0].getOpts();
      } else if (args[0] instanceof SendOpts) {
        opts = args[0].getOpts();
      } else {
        parameter = args[0];
      }
      break;
    }
    case 2: {
      parameter = args[0];
      if (args[1] instanceof Opts) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        opts = args[1].getOpts();
      } else if (args[1] instanceof SendOpts) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        opts = args[1].getOpts();
      } else {
        throw new TypeError(
          "The second argument must be either Opts or SendOpts"
        );
      }
      break;
    }
    default: {
      throw new TypeError("unexpected number of arguments");
    }
  }
  return {
    parameter,
    opts,
  };
}

export const defaultSerde = <T>(): Serde<T> => {
  return serde.json as Serde<T>;
};

export const makeRpcCallProxy = <T>(
  genericCall: (call: GenericCall<unknown, unknown>) => Promise<unknown>,
  service: string,
  key?: string
): T => {
  const clientProxy = new Proxy(
    {},
    {
      get: (_target, prop) => {
        const method = prop as string;
        return (...args: unknown[]) => {
          const { parameter, opts } = optsFromArgs(args);
          const requestSerde = opts?.input ?? defaultSerde();
          const responseSerde =
            (opts as ClientCallOptions<unknown, unknown> | undefined)?.output ??
            defaultSerde();
          return genericCall({
            service,
            method,
            parameter,
            key,
            headers: opts?.headers,
            inputSerde: requestSerde,
            outputSerde: responseSerde,
            idempotencyKey: opts?.idempotencyKey,
          });
        };
      },
    }
  );

  return clientProxy as T;
};

export const makeRpcSendProxy = <T>(
  genericSend: (send: GenericSend<unknown>) => void,
  service: string,
  key?: string,
  legacyDelay?: number
): T => {
  const clientProxy = new Proxy(
    {},
    {
      get: (_target, prop) => {
        const method = prop as string;
        return (...args: unknown[]) => {
          const { parameter, opts } = optsFromArgs(args);
          const requestSerde = opts?.input ?? defaultSerde();
          const delay =
            legacyDelay ??
            (opts as ClientSendOptions<unknown> | undefined)?.delay;
          return genericSend({
            service,
            method,
            parameter,
            key,
            headers: opts?.headers,
            delay,
            inputSerde: requestSerde,
            idempotencyKey: opts?.idempotencyKey,
          });
        };
      },
    }
  );

  return clientProxy as T;
};

export type InferArg<P> = P extends [infer A, ...any[]] ? A : unknown;

export type Client<M> = {
  [K in keyof M as M[K] extends never ? never : K]: M[K] extends (
    arg: any,
    ...args: infer P
  ) => PromiseLike<infer O>
    ? (
        ...args: [...P, ...[opts?: Opts<InferArg<P>, O>]]
      ) => InvocationPromise<O>
    : never;
};

export type SendClient<M> = {
  [K in keyof M as M[K] extends never ? never : K]: M[K] extends (
    arg: any,
    ...args: infer P
  ) => void
    ? (...args: [...P, ...[opts?: SendOpts<InferArg<P>>]]) => InvocationHandle
    : never;
};

// ----------- handlers ----------------------------------------------

export enum HandlerKind {
  SERVICE,
  EXCLUSIVE,
  SHARED,
  WORKFLOW,
}

export type ServiceHandlerOpts<I, O> = {
  /**
   * Define the acceptable content-type for this handler when a request is received at the ingress.
   * Wildcards can be used, e.g. `application/*` or `* / *`.
   *
   * If not provided, the `input.contentType` will be used instead as default.
   *
   * Setting this value has no effect on the input serde.
   * If you want to customize how to deserialize the input, you still need to provide an `input` serde.
   */
  accept?: string;

  /**
   * The Serde to use for deserializing the input parameter.
   * defaults to: restate.serde.json
   *
   * Provide a custom Serde if the input is not JSON, or use:
   * restate.serde.binary the skip serialization/deserialization altogether.
   * in that case, the input parameter is a Uint8Array.
   */
  input?: Serde<I>;

  /**
   * The Serde to use for serializing the output.
   * defaults to: restate.serde.json
   *
   * Provide a custom Serde if the output is not JSON, or use:
   * restate.serde.binary the skip serialization/deserialization altogether.
   * in that case, the output parameter is a Uint8Array.
   */
  output?: Serde<O>;

  /**
   * An additional description for the handler, for documentation purposes.
   */
  description?: string;

  /**
   * Additional metadata for the handler.
   */
  metadata?: Record<string, string>;

  /**
   * The retention duration of idempotent requests to this handler.
   *
   * *NOTE:* You can set this field only if you register this endpoint against restate-server >= 1.4,
   * otherwise the service discovery will fail.
   */
  idempotencyRetention?: Duration | number;

  /**
   * The journal retention for invocations to this handler.
   *
   * In case the request has an idempotency key, the `idempotencyRetention` caps the journal retention time.
   *
   * *NOTE:* You can set this field only if you register this endpoint against restate-server >= 1.4,
   * otherwise the service discovery will fail.
   */
  journalRetention?: Duration | number;

  /**
   * This timer guards against stalled invocations. Once it expires, Restate triggers a graceful
   * termination by asking the invocation to suspend (which preserves intermediate progress).
   *
   * The `abortTimeout` is used to abort the invocation, in case it doesn't react to the request to
   * suspend.
   *
   * This overrides the inactivity timeout set for the service and the default set in restate-server.
   *
   * *NOTE:* You can set this field only if you register this endpoint against restate-server >= 1.4,
   * otherwise the service discovery will fail.
   */
  inactivityTimeout?: Duration | number;

  /**
   * This timer guards against stalled invocations that are supposed to terminate. The abort timeout
   * is started after the [inactivityTimeout] has expired and the invocation has been asked to
   * gracefully terminate. Once the timer expires, it will abort the invocation.
   *
   * This timer potentially *interrupts* user code. If the user code needs longer to gracefully
   * terminate, then this value needs to be set accordingly.
   *
   * This overrides the abort timeout set for the service and the default set in restate-server.
   *
   * *NOTE:* You can set this field only if you register this endpoint against restate-server >= 1.4,
   * otherwise the service discovery will fail.
   */
  abortTimeout?: Duration | number;

  /**
   * When set to `true` this handler cannot be invoked from the restate-server HTTP and Kafka ingress,
   * but only from other services.
   *
   * *NOTE:* You can set this field only if you register this endpoint against restate-server >= 1.4,
   * otherwise the service discovery will fail.
   */
  ingressPrivate?: boolean;
};

export type ObjectHandlerOpts<I, O> = ServiceHandlerOpts<I, O> & {
  /**
   * When set to `true`, lazy state will be enabled for all invocations to this handler.
   *
   * *NOTE:* You can set this field only if you register this endpoint against restate-server >= 1.4,
   * otherwise the service discovery will fail.
   */
  enableLazyState?: boolean;
};

export type WorkflowHandlerOpts<I, O> = ServiceHandlerOpts<I, O> & {
  /**
   * When set to `true`, lazy state will be enabled for all invocations to this handler.
   *
   * *NOTE:* You can set this field only if you register this endpoint against restate-server >= 1.4,
   * otherwise the service discovery will fail.
   */
  enableLazyState?: boolean;
};

const HANDLER_SYMBOL = Symbol("Handler");

export class HandlerWrapper {
  public static from(
    kind: HandlerKind,
    handler: Function,
    opts?:
      | ServiceHandlerOpts<unknown, unknown>
      | ObjectHandlerOpts<unknown, unknown>
      | WorkflowHandlerOpts<unknown, unknown>
  ): HandlerWrapper {
    const inputSerde: Serde<unknown> = opts?.input ?? defaultSerde();
    const outputSerde: Serde<unknown> = opts?.output ?? defaultSerde();

    // we must create here a copy of the handler
    // to be able to reuse the original handler in other places.
    // like for example the same logic but under different routes.
    const handlerCopy = function (this: any, ...args: any[]): any {
      return handler.apply(this, args);
    };

    return new HandlerWrapper(
      kind,
      handlerCopy,
      inputSerde,
      outputSerde,
      opts?.accept,
      opts?.description,
      opts?.metadata,
      opts?.idempotencyRetention,
      opts?.journalRetention,
      opts?.inactivityTimeout,
      opts?.abortTimeout,
      opts?.ingressPrivate,
      opts !== undefined && "enableLazyState" in opts
        ? opts?.enableLazyState
        : undefined
    );
  }

  public static fromHandler(handler: any): HandlerWrapper | undefined {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    return handler[HANDLER_SYMBOL] as HandlerWrapper | undefined;
  }

  public readonly accept?: string;
  public readonly contentType?: string;

  private constructor(
    public readonly kind: HandlerKind,
    private handler: Function,
    public readonly inputSerde: Serde<unknown>,
    public readonly outputSerde: Serde<unknown>,
    accept?: string,
    public readonly description?: string,
    public readonly metadata?: Record<string, string>,
    public readonly idempotencyRetention?: Duration | number,
    public readonly journalRetention?: Duration | number,
    public readonly inactivityTimeout?: Duration | number,
    public readonly abortTimeout?: Duration | number,
    public readonly ingressPrivate?: boolean,
    public readonly enableLazyState?: boolean,
    public readonly asTerminalError?: (error: any) => TerminalError | undefined
  ) {
    this.accept = accept !== undefined ? accept : inputSerde.contentType;
    this.contentType = outputSerde.contentType;
  }

  bindInstance(t: unknown) {
    this.handler = this.handler.bind(t) as Function;
  }

  async invoke(context: unknown, input: Uint8Array) {
    let req: unknown;
    try {
      req = this.inputSerde.deserialize(input);
    } catch (e) {
      const error = ensureError(e);
      throw new TerminalError(`Failed to deserialize input: ${error.message}`, {
        errorCode: 400,
      });
    }
    const res: unknown = await this.handler(context, req);
    return this.outputSerde.serialize(res);
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
/**
 * @deprecated
 */
export type RemoveVoidArgument<F> = F extends (
  ctx: infer C,
  arg: infer A
) => infer R
  ? A extends void
    ? (ctx: C) => R
    : F
  : F;

/**
 * @deprecated
 */
export namespace handlers {
  /**
   * @deprecated To provide options, simply define the handler as
   */
  export function handler<O, I = void>(
    opts: ServiceHandlerOpts<I, O>,
    fn: (ctx: Context, input: I) => Promise<O>
  ): RemoveVoidArgument<typeof fn> {
    return HandlerWrapper.from(HandlerKind.SERVICE, fn, opts).transpose();
  }

  /**
   * @deprecated
   */
  export namespace workflow {
    /**
     * @deprecated
     */
    export function workflow<
      O,
      I = void,
      TState extends TypedState = UntypedState
    >(
      opts: WorkflowHandlerOpts<I, O>,
      fn: (ctx: WorkflowContext<TState>, input: I) => Promise<O>
    ): RemoveVoidArgument<typeof fn>;

    /**
     * @deprecated
     */
    export function workflow<
      O,
      I = void,
      TState extends TypedState = UntypedState
    >(
      fn: (ctx: WorkflowContext<TState>, input: I) => Promise<O>
    ): RemoveVoidArgument<typeof fn>;

    /**
     * @deprecated
     */
    export function workflow<O, I = void>(
      optsOrFn:
        | WorkflowHandlerOpts<I, O>
        | ((ctx: WorkflowContext, input: I) => Promise<O>),
      fn?: (ctx: WorkflowContext, input: I) => Promise<O>
    ) {
      if (typeof optsOrFn === "function") {
        return HandlerWrapper.from(HandlerKind.WORKFLOW, optsOrFn).transpose();
      }
      const opts = optsOrFn satisfies WorkflowHandlerOpts<I, O>;
      if (typeof fn !== "function") {
        throw new TypeError("The second argument must be a function");
      }
      return HandlerWrapper.from(HandlerKind.WORKFLOW, fn, opts).transpose();
    }

    /**
     * @deprecated
     */
    export function shared<
      O,
      I = void,
      TState extends TypedState = UntypedState
    >(
      opts: WorkflowHandlerOpts<I, O>,
      fn: (ctx: WorkflowSharedContext<TState>, input: I) => Promise<O>
    ): RemoveVoidArgument<typeof fn>;

    /**
     * @deprecated
     */
    export function shared<
      O,
      I = void,
      TState extends TypedState = UntypedState
    >(
      fn: (ctx: WorkflowSharedContext<TState>, input: I) => Promise<O>
    ): RemoveVoidArgument<typeof fn>;

    /**
     * @deprecated
     */
    export function shared<O, I = void>(
      optsOrFn:
        | WorkflowHandlerOpts<I, O>
        | ((ctx: WorkflowSharedContext, input: I) => Promise<O>),
      fn?: (ctx: WorkflowSharedContext, input: I) => Promise<O>
    ) {
      if (typeof optsOrFn === "function") {
        return HandlerWrapper.from(HandlerKind.SHARED, optsOrFn).transpose();
      }
      const opts = optsOrFn satisfies ObjectHandlerOpts<I, O>;
      if (typeof fn !== "function") {
        throw new TypeError("The second argument must be a function");
      }
      return HandlerWrapper.from(HandlerKind.SHARED, fn, opts).transpose();
    }
  }

  /**
   * @deprecated
   */
  export namespace object {
    /**
     * @deprecated
     */
    export function exclusive<
      O,
      I = void,
      TState extends TypedState = UntypedState
    >(
      opts: ObjectHandlerOpts<I, O>,
      fn: (ctx: ObjectContext<TState>, input: I) => Promise<O>
    ): RemoveVoidArgument<typeof fn>;

    /**
     * @deprecated
     */
    export function exclusive<
      O,
      I = void,
      TState extends TypedState = UntypedState
    >(
      fn: (ctx: ObjectContext<TState>, input: I) => Promise<O>
    ): RemoveVoidArgument<typeof fn>;

    /**
     * @deprecated
     */
    export function exclusive<O, I = void>(
      optsOrFn:
        | ObjectHandlerOpts<I, O>
        | ((ctx: ObjectContext, input: I) => Promise<O>),
      fn?: (ctx: ObjectContext, input: I) => Promise<O>
    ) {
      if (typeof optsOrFn === "function") {
        return HandlerWrapper.from(HandlerKind.EXCLUSIVE, optsOrFn).transpose();
      }
      const opts = optsOrFn satisfies ObjectHandlerOpts<I, O>;
      if (typeof fn !== "function") {
        throw new TypeError("The second argument must be a function");
      }
      return HandlerWrapper.from(HandlerKind.EXCLUSIVE, fn, opts).transpose();
    }

    /**
     * @deprecated
     */
    export function shared<
      O,
      I = void,
      TState extends TypedState = UntypedState
    >(
      opts: ObjectHandlerOpts<I, O>,
      fn: (ctx: ObjectSharedContext<TState>, input: I) => Promise<O>
    ): RemoveVoidArgument<typeof fn>;

    /**
     * @deprecated
     */
    export function shared<
      O,
      I = void,
      TState extends TypedState = UntypedState
    >(
      fn: (ctx: ObjectSharedContext<TState>, input: I) => Promise<O>
    ): RemoveVoidArgument<typeof fn>;

    /**
     * @deprecated
     */
    export function shared<I, O>(
      optsOrFn:
        | ObjectHandlerOpts<I, O>
        | ((ctx: ObjectSharedContext, input: I) => Promise<O>),
      fn?: (ctx: ObjectSharedContext, input: I) => Promise<O>
    ) {
      if (typeof optsOrFn === "function") {
        return HandlerWrapper.from(HandlerKind.SHARED, optsOrFn).transpose();
      }
      const opts = optsOrFn satisfies ObjectHandlerOpts<I, O>;
      if (typeof fn !== "function") {
        throw new TypeError("The second argument must be a function");
      }
      return HandlerWrapper.from(HandlerKind.SHARED, fn, opts).transpose();
    }
  }
}

// ----------- common ----------------------------------------------

export type Handler<F, C, I = any, O = any> = F extends (
  ctx: C,
  param: I
) => Promise<O>
  ? F
  : F extends (ctx: C) => Promise<O>
  ? F
  : (ctx: C, param?: I) => Promise<O>;

// ----------- services ----------------------------------------------

export type ServiceHandlerDefinition<U, I = any, O = any> =
  | Handler<U, Context, I, O>
  | ({
      handler: Handler<U, Context, I, O>;
    } & ServiceHandlerOpts<I, O>);

export type ServiceHandlers<U> = {
  [K in keyof U]: ServiceHandlerDefinition<U>;
};

/**
 * @deprecated Use ServiceHandlers instead.
 */
export type ServiceOpts<U> = ServiceHandlers<U>;

export type ServiceOptions = {
  /**
   * The retention duration of idempotent requests to this service.
   *
   * *NOTE:* You can set this field only if you register this endpoint against restate-server >= 1.4,
   * otherwise the service discovery will fail.
   */
  idempotencyRetention?: Duration | number;

  /**
   * The journal retention. When set, this applies to all requests to all handlers of this service.
   *
   * In case the request has an idempotency key, the `idempotencyRetention` caps the journal retention
   * time.
   *
   * *NOTE:* You can set this field only if you register this endpoint against restate-server >= 1.4,
   * otherwise the service discovery will fail.
   *
   * @return this
   */
  journalRetention?: Duration | number;

  /**
   * This timer guards against stalled invocations. Once it expires, Restate triggers a graceful
   * termination by asking the invocation to suspend (which preserves intermediate progress).
   *
   * The `abortTimeout` is used to abort the invocation, in case it doesn't react to the request to
   * suspend.
   *
   * This overrides the default inactivity timeout configured in the restate-server for all
   * invocations to this service.
   *
   * *NOTE:* You can set this field only if you register this endpoint against restate-server >= 1.4,
   * otherwise the service discovery will fail.
   */
  inactivityTimeout?: Duration | number;

  /**
   * This timer guards against stalled service/handler invocations that are supposed to terminate. The
   * abort timeout is started after the `inactivityTimeout` has expired and the service/handler
   * invocation has been asked to gracefully terminate. Once the timer expires, it will abort the
   * service/handler invocation.
   *
   * This timer potentially *interrupts* user code. If the user code needs longer to gracefully
   * terminate, then this value needs to be set accordingly.
   *
   * This overrides the default abort timeout configured in the restate-server for all invocations to
   * this service.
   *
   * *NOTE:* You can set this field only if you register this endpoint against restate-server >= 1.4,
   * otherwise the service discovery will fail.
   */
  abortTimeout?: Duration | number;

  /**
   * When set to `true` this service, with all its handlers, cannot be invoked from the restate-server
   * HTTP and Kafka ingress, but only from other services.
   *
   * *NOTE:* You can set this field only if you register this endpoint against restate-server >= 1.4,
   * otherwise the service discovery will fail.
   */
  ingressPrivate?: boolean;

  /**
   * By default, Restate will consider any error terminal, that is non retryable, if it's an instance of `TerminalError`.
   *
   * By setting this field, you can provide a function to map specific errors in your domain to `TerminalError` (or undefined, if the error should be considered retryable). Once `TerminalError`, these errors won't be retried.
   *
   * Note: this will be used both for errors thrown by `ctx.run` closures and by errors thrown in restate handlers.
   *
   * Example:
   *
   * ```ts
   * class MyValidationError extends Error {}
   *
   * const greeter = restate.service({
   *   name: "greeter",
   *   handlers: {
   *     greet: async (ctx: restate.Context, name: string) => {
   *       if (name.length === 0) {
   *         throw new MyValidationError("Length too short");
   *       }
   *       return `Hello ${name}`;
   *     }
   *   },
   *   options: {
   *     asTerminalError: (err) => {
   *       if (err instanceof MyValidationError) {
   *         // My validation error is terminal
   *         return new restate.TerminalError(err.message, {errorCode: 400})
   *       }
   *
   *       // Any other error is retryable
   *     }
   *   }
   * });
   * ```
   */
  asTerminalError?: (error: any) => TerminalError | undefined;
};

/**
 * Define a Restate service.
 *
 * @example Here is an example of how to define a service:
 *
 * ```ts
 * const greeter = service({
 *   name: "greeter",
 *   handlers: {
 *     greet: async (ctx: Context, name: string) => {
 *       return `Hello ${name}`;
 *     }
 *   }
 * });
 * ```
 *
 * To use the service, you can bind it to an endpoint:
 * ```
 * ...
 * endpoint.bind(greeter)
 * ```
 * @example To use a service, you can export its type to be used in a client:
 * ```
 * export type Greeter = typeof greeter;
 * ...
 * ...
 * import type { Greeter } from "./greeter";
 * const client = ctx.serviceClient<Greeter>({ name : "greeter"});
 * client.greet("World").then(console.log);
 * ```
 *
 * @example Alternatively to avoid repeating the service name, you can:
 * ```
 * import type {Greeter} from "./greeter";
 * const Greeter: Greeter = { name : "greeter"};
 *
 * // now you can reference the service like this:
 * const client = ctx.serviceClient(Greeter);
 * ```
 *
 * @param name the service name
 * @param handlers the handlers for the service
 * @param description an optional description for the service
 * @param metadata an optional metadata for the service
 * @type P the name of the service
 * @type M the handlers for the service
 */
export const service = <P extends string, M>(service: {
  name: P;
  handlers: M & ServiceHandlers<M> & ThisType<M>;
  description?: string;
  metadata?: Record<string, string>;
  options?: ServiceOptions;
}): ServiceDefinition<P, M> => {
  if (!service.handlers) {
    throw new Error("service must be defined");
  }
  const handlers = Object.entries(service.handlers).map(([name, handler]) => {
    if (handler instanceof Function) {
      if (HandlerWrapper.fromHandler(handler) !== undefined) {
        return [name, handler];
      }
      return [
        name,
        HandlerWrapper.from(HandlerKind.SERVICE, handler).transpose(),
      ];
    } else if (typeof handler === "object") {
      const handlerDefinition = handler as {
        handler?: Function;
      } & ServiceHandlerOpts<any, any>;
      if (!handlerDefinition || !handlerDefinition?.handler) {
        throw new TypeError(
          `Expected handler definition ${name} to contain field 'handler'`
        );
      }
      return [
        name,
        HandlerWrapper.from(
          HandlerKind.SERVICE,
          handlerDefinition.handler,
          handlerDefinition
        ).transpose(),
      ];
    }
    throw new TypeError(`Unexpected handler type ${name}`);
  });

  return {
    name: service.name,
    service: Object.fromEntries(handlers) as object,
    metadata: service.metadata,
    description: service.description,
    options: service.options,
  } as ServiceDefinition<P, M>;
};

// ----------- objects ----------------------------------------------

export type ObjectHandlerDefinition<
  U,
  TState extends TypedState = UntypedState,
  I = any,
  O = any
> =
  | Handler<U, ObjectContext<TState>, I, O>
  | ({
      sharedHandler: Handler<U, ObjectSharedContext<TState>, I, O>;
    } & ObjectHandlerOpts<I, O>)
  | ({
      handler: Handler<U, ObjectContext<TState>, I, O>;
    } & ObjectHandlerOpts<I, O>);

export type ObjectHandlers<U, TState extends TypedState = UntypedState> = {
  [K in keyof U]: ObjectHandlerDefinition<unknown, TState>;
};

/**
 * @deprecated Use ObjectHandlers instead.
 */
export type ObjectOpts<
  U,
  TState extends TypedState = UntypedState
> = ObjectHandlers<U, TState>;

export type ObjectOptions = ServiceOptions & {
  /**
   * When set to `true`, lazy state will be enabled for all invocations to this service.
   *
   * *NOTE:* You can set this field only if you register this endpoint against restate-server >= 1.4,
   * otherwise the service discovery will fail.
   */
  enableLazyState?: boolean;
};

/**
 * Define a Restate virtual object.
 *
 * @example Here is an example of how to define a virtual object:
 * ```ts
 *        const counter = object({
 *            name: "counter",
 *            handlers: {
 *                  add: async (ctx: ObjectContext, amount: number) => {},
 *                  get: async (ctx: ObjectContext) => {}
 *            }
 *        })
 *  ```
 *
 * @example To use the object, you can bind it to an endpoint:
 * ```ts
 * ...
 * endpoint.bind(counter)
 * ```
 *
 *  @see to interact with the object, you can use the object client:
 * ```ts
 * ...
 * const client = ctx.objectClient<typeof counter>({ name: "counter"});
 * const res = await client.add(1)
 * ```
 *
 * ### Shared handlers
 *
 * Shared handlers are used to allow concurrent read-only access to the object.
 * This is useful when you want to allow multiple clients to read the object's state at the same time.
 * To define a shared handler, you can use the `shared` decorator as shown below:
 *
 * ```ts
 *      const counter = object({
 *          name: "counter",
 *          handlers: {
 *
 *            add: async (ctx: ObjectContext, amount: number) => { .. },
 *
 *            get: handlers.object.shared(async (ctx: ObjectSharedContext) => {
 *                  return ctx.get<number>("count");
 *            })
 *       }
 *     });
 * ```
 *
 * @param name the name of the object
 * @param handlers the handlers for the object
 * @param description an optional description for the object
 * @param metadata an optional metadata for the object
 * @type P the name of the object
 * @type M the handlers for the object
 */
export const object = <P extends string, M>(object: {
  name: P;
  handlers: M & ObjectHandlers<M> & ThisType<M>;
  description?: string;
  metadata?: Record<string, string>;
  options?: ObjectOptions;
}): VirtualObjectDefinition<P, M> => {
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
    } else if (typeof handler === "object") {
      const handlerDefinition = handler as {
        handler?: Function;
        sharedHandler?: Function;
      } & ObjectHandlerOpts<any, any>;
      if (!handlerDefinition) {
        throw new TypeError(
          `Expected handler definition ${name} to be non-empty`
        );
      }
      if (handlerDefinition.handler) {
        return [
          name,
          HandlerWrapper.from(
            HandlerKind.EXCLUSIVE,
            handlerDefinition.handler,
            handlerDefinition
          ).transpose(),
        ];
      }
      if (handlerDefinition.sharedHandler) {
        return [
          name,
          HandlerWrapper.from(
            HandlerKind.SHARED,
            handlerDefinition.sharedHandler,
            handlerDefinition
          ).transpose(),
        ];
      }
      throw new TypeError(
        `Expected handler definition ${name} to contain field 'handler' or 'sharedHandler'`
      );
    }
    throw new TypeError(`Unexpected handler type ${name}`);
  });

  return {
    name: object.name,
    object: Object.fromEntries(handlers) as object,
    metadata: object.metadata,
    description: object.description,
    options: object.options,
  } as VirtualObjectDefinition<P, M>;
};

// ----------- workflows ----------------------------------------------

export type WorkflowHandlerDefinition<
  U,
  TState extends TypedState = UntypedState,
  I = any,
  O = any
> =
  | Handler<U, WorkflowContext<TState>, I, O>
  | ({
      handler: Handler<U, WorkflowContext<TState>, I, O>;
    } & WorkflowHandlerOpts<I, O>);

export type WorkflowSharedHandlerDefinition<
  U,
  TState extends TypedState = UntypedState,
  I = any,
  O = any
> =
  | Handler<U, WorkflowSharedContext<TState>, I, O>
  | ({
      handler: Handler<U, WorkflowSharedContext<TState>, I, O>;
    } & WorkflowHandlerOpts<I, O>);

/**
 * A workflow handlers is a type that describes the handlers for a workflow.
 * The handlers must contain exactly one handler named 'run', and this handler must accept as a first argument a WorkflowContext.
 * It can contain any number of additional handlers, which must accept as a first argument a WorkflowSharedContext.
 * The handlers can not be named 'workflowSubmit', 'workflowAttach', 'workflowOutput' - as these are reserved.
 * @see {@link workflow} for an example.
 */
export type WorkflowHandlers<U, TState extends TypedState = UntypedState> = {
  [K in keyof U]: K extends
    | "workflowSubmit"
    | "workflowAttach"
    | "workflowOutput"
    ? `${K} is a reserved keyword`
    : K extends "run"
    ? WorkflowHandlerDefinition<U[K], TState>
    : WorkflowSharedHandlerDefinition<U[K], TState>;
} & { run: any };

/**
 * @deprecated Use WorkflowHandlers instead.
 */
export type WorkflowOpts<U> = WorkflowHandlers<U>;

export type WorkflowOptions = ServiceOptions & {
  /**
   * The retention duration for this workflow.
   *
   * *NOTE:* You can set this field only if you register this endpoint against restate-server >= 1.4,
   * otherwise the service discovery will fail.
   */
  workflowRetention?: Duration | number;
  /**
   * When set to `true`, lazy state will be enabled for all invocations to this service.
   *
   * *NOTE:* You can set this field only if you register this endpoint against restate-server >= 1.4,
   * otherwise the service discovery will fail.
   */
  enableLazyState?: boolean;
};

/**
 * Define a Restate workflow.
 *
 *
 * @example Here is an example of how to define a workflow:
 * ```ts
 * const mywf = workflow({
 *   name: "mywf",
 *   handlers: {
 *     run: async (ctx: WorkflowContext, argument: any) => {
 *       return "Hello World";
 *     }
 *   }
 * });
 * ```
 *
 * ### Note:
 * * That a workflow must contain exactly one handler named 'run', and this handler must accept as a first argument a WorkflowContext.
 * * The workflow handlers other than 'run' must accept as a first argument a WorkflowSharedContext.
 * * The workflow handlers can not be named 'workflowSubmit', 'workflowAttach', 'workflowOutput' - as these are reserved keywords.
 *
 * @example To use the workflow, you can bind it to an endpoint:
 * ```ts
 * endpoint.bind(mywf)
 * ```
 *
 * @example To interact with the workflow, you can use the workflow client:
 * ```ts
 * const client = ctx.workflowClient<typeof mywf>({ name: "mywf"});
 * const res = await client.run("Hello");
 * ```
 *
 * To use the workflow client from any other environment (like a browser), please refer to the documentation.
 * https://docs.restate.dev
 *
 *
 *
 * @param name the workflow name
 * @param handlers the handlers for the workflow.
 */
export const workflow = <P extends string, M>(workflow: {
  name: P;
  handlers: M & WorkflowHandlers<M> & ThisType<M>;
  description?: string;
  metadata?: Record<string, string>;
  options?: WorkflowOptions;
}): WorkflowDefinition<P, M> => {
  if (!workflow.handlers) {
    throw new Error("workflow must contain handlers");
  }

  //
  // Add the main 'run' handler
  //
  const runHandler = workflow.handlers["run"] as
    | Function
    | object
    | HandlerWrapper;
  let runWrapper: HandlerWrapper;

  if (runHandler instanceof HandlerWrapper) {
    runWrapper = runHandler;
  } else if (runHandler instanceof Function) {
    runWrapper =
      HandlerWrapper.fromHandler(runHandler) ??
      HandlerWrapper.from(HandlerKind.WORKFLOW, runHandler);
  } else if (typeof runHandler === "object") {
    const handlerDefinition = runHandler as {
      handler?: Function;
    } & WorkflowHandlerOpts<any, any>;
    if (!handlerDefinition || !handlerDefinition?.handler) {
      throw new TypeError(
        `Expected handler definition run to contain field 'handler'`
      );
    }
    runWrapper = HandlerWrapper.from(
      HandlerKind.WORKFLOW,
      handlerDefinition.handler,
      handlerDefinition
    );
  } else {
    throw new TypeError(`Missing main workflow handler, named 'run'`);
  }
  if (runWrapper.kind !== HandlerKind.WORKFLOW) {
    throw new TypeError(
      `Workflow's main handler handler run, must be of type workflow'`
    );
  }

  const handlers = [["run", runWrapper.transpose()]];

  //
  // Add all the shared handlers now
  //

  for (const [name, handler] of Object.entries(workflow.handlers)) {
    if (name === "run") {
      continue;
    }
    let wrapper: HandlerWrapper;

    if (handler instanceof HandlerWrapper) {
      wrapper = handler;
    } else if (handler instanceof Function) {
      wrapper =
        HandlerWrapper.fromHandler(handler) ??
        HandlerWrapper.from(HandlerKind.SHARED, handler);
    } else if (typeof handler === "object") {
      const handlerDefinition = handler as {
        handler?: Function;
      } & WorkflowHandlerOpts<any, any>;
      if (!handlerDefinition || !handlerDefinition?.handler) {
        throw new TypeError(
          `Expected handler definition ${name} to contain field 'handler'`
        );
      }
      wrapper = HandlerWrapper.from(
        HandlerKind.SHARED,
        handlerDefinition.handler,
        handlerDefinition
      );
    } else {
      throw new TypeError(`Unexpected handler type ${name}`);
    }
    if (wrapper.kind === HandlerKind.WORKFLOW) {
      throw new TypeError(
        `A workflow must contain exactly one handler annotated as workflow, named 'run'. Please use a shared handler for any additional handlers`
      );
    }
    handlers.push([name, wrapper.transpose()]);
  }

  return {
    name: workflow.name,
    workflow: Object.fromEntries(handlers) as object,
    metadata: workflow.metadata,
    description: workflow.description,
    options: workflow.options,
  } as WorkflowDefinition<P, M>;
};
