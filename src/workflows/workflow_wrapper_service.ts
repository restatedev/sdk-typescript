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

import { ContextDate, Request } from "../context";
import * as restate from "../public_api";
import * as wf from "./workflow";
import * as wss from "./workflow_state_service";

const DEFAULT_RETENTION_PERIOD = 7 * 24 * 60 * 60 * 1000; // 1 week

// ----------------------------------------------------------------------------
//                      Workflow Context Implementations
// ----------------------------------------------------------------------------

class SharedContextImpl<P extends string> implements wf.SharedWfContext {
  constructor(
    protected readonly ctx: restate.Context,
    protected readonly wfId: string,
    protected readonly stateServiceApi: wss.api<P>
  ) {}

  workflowId(): string {
    return this.wfId;
  }

  get<T>(stateName: string): Promise<T | null> {
    return this.ctx
      .objectClient(this.stateServiceApi, this.wfId)
      .getState(stateName) as Promise<T | null>;
  }

  promise<T = void>(name: string): wf.DurablePromise<T> {
    // Create the awakeable to complete
    const awk = this.ctx.awakeable<T>();
    this.ctx
      .objectSendClient(this.stateServiceApi, this.wfId)
      .subscribePromise({
        promiseName: name,
        awkId: awk.id,
      });

    // Prepare implementation of DurablePromise

    const peek = async (): Promise<T | null> => {
      const result = await this.ctx
        .objectClient(this.stateServiceApi, this.wfId)
        .peekPromise({ promiseName: name });

      if (result === null) {
        return null;
      }
      if (result.error !== undefined) {
        return Promise.reject(new Error(result.error));
      }
      return Promise.resolve<T>(result.value as T);
    };

    const resolve = (value: T) => {
      const currentValue = value === undefined ? null : value;

      this.ctx
        .objectSendClient(this.stateServiceApi, this.wfId)
        .completePromise({
          promiseName: name,
          completion: { value: currentValue },
        });
    };

    const reject = (errorMsg: string) => {
      this.ctx
        .objectSendClient(this.stateServiceApi, this.wfId)
        .completePromise({
          promiseName: name,
          completion: { error: errorMsg },
        });
    };

    return Object.defineProperties(awk.promise, {
      peek: {
        value: peek.bind(this),
      },
      resolve: {
        value: resolve.bind(this),
      },
      reject: {
        value: reject.bind(this),
      },
    }) as wf.DurablePromise<T>;
  }
}

class ExclusiveContextImpl<P extends string>
  extends SharedContextImpl<P>
  implements wf.WfContext
{
  public readonly rand: restate.Rand;
  public readonly console: Console;
  public readonly date: ContextDate;

  constructor(ctx: restate.Context, wfId: string, stateServiceApi: wss.api<P>) {
    super(ctx, wfId, stateServiceApi);
    this.rand = ctx.rand;
    this.console = ctx.console;
    this.date = ctx.date;
  }

  request(): Request {
    return this.ctx.request();
  }

  set<T>(stateName: string, value: T): void {
    if (value === undefined || value === null) {
      throw new restate.TerminalError("Cannot set state to null or undefined");
    }

    this.ctx
      .objectSendClient(this.stateServiceApi, this.wfId)
      .setState({ stateName, value });
  }

  clear(stateName: string): void {
    this.ctx
      .objectSendClient(this.stateServiceApi, this.wfId)
      .clearState(stateName);
  }

  stateKeys(): Promise<Array<string>> {
    return this.ctx.objectClient(this.stateServiceApi, this.wfId).stateKeys();
  }

  clearAll(): void {
    this.ctx.objectSendClient(this.stateServiceApi, this.wfId).clearAllState();
  }

  sideEffect<T>(fn: () => Promise<T>): Promise<T> {
    return this.ctx.sideEffect(fn);
  }

  awakeable<T>(): { id: string; promise: restate.CombineablePromise<T> } {
    return this.ctx.awakeable();
  }
  resolveAwakeable<T>(id: string, payload: T): void {
    this.ctx.resolveAwakeable(id, payload);
  }
  rejectAwakeable(id: string, reason: string): void {
    this.ctx.rejectAwakeable(id, reason);
  }

  sleep(millis: number): restate.CombineablePromise<void> {
    return this.ctx.sleep(millis);
  }

  key(): string {
    const kctx = this.ctx as restate.ObjectContext;
    return kctx.key();
  }

  serviceClient<P extends string, M>(
    opts: restate.ServiceDefintion<P, M>
  ): restate.Client<M> {
    return this.ctx.serviceClient(opts);
  }
  objectClient<P extends string, M>(
    opts: restate.ServiceDefintion<P, M>,
    key: string
  ): restate.Client<M> {
    return this.ctx.objectClient(opts, key);
  }
  objectSendClient<P extends string, M>(
    opts: restate.ServiceDefintion<P, M>,
    key: string
  ): restate.SendClient<M> {
    return this.ctx.objectSendClient(opts, key);
  }
  serviceSendClient<P extends string, M>(
    opts: restate.ServiceDefintion<P, M>
  ): restate.SendClient<M> {
    return this.ctx.serviceSendClient(opts);
  }
  objectSendDelayedClient<P extends string, M>(
    opts: restate.ServiceDefintion<P, M>,
    delay: number,
    key: string
  ): restate.SendClient<M> {
    return this.ctx.objectSendDelayedClient(opts, delay, key);
  }
  serviceSendDelayedClient<P extends string, M>(
    opts: restate.ServiceDefintion<P, M>,
    delay: number
  ): restate.SendClient<M> {
    return this.ctx.serviceSendDelayedClient(opts, delay);
  }
}

// ----------------------------------------------------------------------------
//               the service that wraps the workflow methods
// ----------------------------------------------------------------------------

export function createWrapperService<P extends string, R, T, M>(
  workflow: wf.Workflow<R, T, M>,
  name: P,
  stateServiceApi: wss.api<P>
) {
  const wrapperService = {
    submit: async (
      ctx: restate.Context,
      request: wf.WorkflowRequest<T>
    ): Promise<wf.WorkflowStartResult> => {
      checkRequestAndWorkflowId(request);

      const started = await ctx
        .objectClient(stateServiceApi, request.workflowId)
        .startWorkflow();
      if (started === wf.WorkflowStartResult.STARTED) {
        ctx.serviceClient(api).run(request);
      }
      return started;
    },

    run: async (
      ctx: restate.Context,
      request: wf.WorkflowRequest<T>
    ): Promise<R> => {
      checkRequestAndWorkflowId(request);

      const wfCtx = new ExclusiveContextImpl(
        ctx,
        request.workflowId,
        stateServiceApi
      );
      try {
        const result = await workflow.run(wfCtx, request);
        const resultValue = result !== undefined ? result : {};
        await ctx
          .objectClient(stateServiceApi, request.workflowId)
          .finishOrFailWorkflow({ value: resultValue });
        return result;
      } catch (err) {
        const msg = stringifyError(err);
        await ctx
          .objectClient(stateServiceApi, request.workflowId)
          .finishOrFailWorkflow({ error: msg });
        throw err;
      } finally {
        ctx
          .objectSendDelayedClient(
            stateServiceApi,
            DEFAULT_RETENTION_PERIOD,
            request.workflowId
          )
          .dispose();
      }
    },

    waitForResult: async (
      ctx: restate.Context,
      request: wf.WorkflowRequest<unknown>
    ): Promise<R> => {
      checkRequestAndWorkflowId(request);

      const awakeable = ctx.awakeable<R>();
      await ctx
        .objectClient(stateServiceApi, request.workflowId)
        .subscribeResult(awakeable.id);
      return awakeable.promise;
    },

    status: async (
      ctx: restate.Context,
      request: wf.WorkflowRequest<unknown>
    ): Promise<wf.LifecycleStatus> => {
      checkRequestAndWorkflowId(request);
      return ctx.objectClient(stateServiceApi, request.workflowId).getStatus();
    },
  };

  // add all the interaction methods to the wrapper service
  for (const [route, handler] of Object.entries(workflow)) {
    if (typeof handler !== "function" || route === "run") {
      continue;
    }
    if (handler.length < 1 || handler.length > 2) {
      throw new Error(
        "Workflow function does not conform to correct signature: must have at least one argument (SharedWfContext) and at most a second argument (the request parameter)"
      );
    }

    const wrappingHandler = async <OUT, IN>(
      ctx: restate.Context,
      request: wf.WorkflowRequest<IN>
    ): Promise<OUT> => {
      checkRequestAndWorkflowId(request);
      const wfCtx = new SharedContextImpl(
        ctx,
        request.workflowId,
        stateServiceApi
      );

      // impl. note: we need the extra cast to 'unknown', because the 'run' method is
      // otherwise incompatible with the cast. we exclude that method in the filter above,
      // but the compiler doesn't recognize that.
      return (
        handler as unknown as (ctx: wf.SharedWfContext, req: IN) => Promise<OUT>
      )(wfCtx, request);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (wrapperService as any)[route] = wrappingHandler;
  }

  const service = restate.service({ name, handlers: wrapperService });
  const api: typeof service = { name };
  return service;
}

function checkRequestAndWorkflowId(request: wf.WorkflowRequest<unknown>): void {
  if (request === undefined) {
    throw new restate.TerminalError("Request parameter is undefined");
  }
  if (request.workflowId === undefined) {
    throw new restate.TerminalError("Request is missing property 'workflowId'");
  }
}

function stringifyError(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    const e = error as Error;
    return `${e.name}: ${e.message}\nStack: ${e.stack}`;
  }
  try {
    return JSON.stringify(error);
  } catch (err) {
    return "(cause not stringify-able)";
  }
}
