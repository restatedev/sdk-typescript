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

import * as restate from "../public_api";
import * as wf from "./workflow";
import * as wss from "./workflow_state_service";

const DEFAULT_RETENTION_PERIOD = 7 * 24 * 60 * 60 * 1000; // 1 week

// ----------------------------------------------------------------------------
//                      Workflow Context Implementations
// ----------------------------------------------------------------------------

class SharedPromiseImpl<T> implements wf.DurablePromise<T> {
  constructor(
    private readonly workflowId: string,
    private readonly promiseName: string,
    private readonly ctx: restate.Context,
    private readonly stateServiceApi: restate.ServiceApi<wss.api>
  ) {}

  promise(): Promise<T> {
    const awk = this.ctx.awakeable<T>();

    this.ctx.send(this.stateServiceApi).subscribePromise(this.workflowId, {
      promiseName: this.promiseName,
      awkId: awk.id,
    });

    return awk.promise;
  }

  async peek(): Promise<T | null> {
    const result = await this.ctx
      .rpc(this.stateServiceApi)
      .peekPromise(this.workflowId, { promiseName: this.promiseName });

    if (result === null) {
      return null;
    }
    if (result.error !== undefined) {
      return Promise.reject(new Error(result.error));
    }
    return Promise.resolve<T>(result.value as T);
  }

  resolve(value?: T): void {
    this.ctx.send(this.stateServiceApi).completePromise(this.workflowId, {
      promiseName: this.promiseName,
      completion: { value },
    });
  }

  fail(errorMsg: string): void {
    this.ctx.send(this.stateServiceApi).completePromise(this.workflowId, {
      promiseName: this.promiseName,
      completion: { error: errorMsg },
    });
  }
}

class SharedContextImpl implements wf.SharedWfContext {
  constructor(
    protected readonly ctx: restate.Context,
    protected readonly wfId: string,
    protected readonly stateServiceApi: restate.ServiceApi<wss.api>
  ) {}

  workflowId(): string {
    return this.wfId;
  }

  get<T>(stateName: string): Promise<T | null> {
    return this.ctx
      .rpc(this.stateServiceApi)
      .getState(this.wfId, stateName) as Promise<T | null>;
  }

  promise<T = void>(name: string): wf.DurablePromise<T> {
    return new SharedPromiseImpl(
      this.wfId,
      name,
      this.ctx,
      this.stateServiceApi
    );
  }
}

class ExclusiveContextImpl extends SharedContextImpl implements wf.WfContext {
  public readonly id: Buffer;
  public readonly serviceName: string;
  public readonly rand: restate.Rand;
  public readonly console: Console;

  constructor(
    ctx: restate.Context,
    wfId: string,
    stateServiceApi: restate.ServiceApi<wss.api>
  ) {
    super(ctx, wfId, stateServiceApi);
    this.id = ctx.id;
    this.serviceName = ctx.serviceName;
    this.rand = ctx.rand;
    this.console = ctx.console;
  }

  grpcChannel(): restate.RestateGrpcChannel {
    return this.ctx.grpcChannel();
  }

  set<T>(stateName: string, value: T): void {
    if (value === undefined || value === null) {
      throw new restate.TerminalError("Cannot set state to null or undefined");
    }

    this.ctx
      .send(this.stateServiceApi)
      .setState(this.wfId, { stateName, value });
  }

  clear(stateName: string): void {
    this.ctx.send(this.stateServiceApi).clearState(this.wfId, stateName);
  }

  stateKeys(): Promise<Array<string>> {
    return this.ctx.rpc(this.stateServiceApi).stateKeys(this.wfId);
  }

  clearAll(): void {
    this.ctx.send(this.stateServiceApi).clearAllState(this.wfId);
  }

  sideEffect<T>(
    fn: () => Promise<T>,
    retryPolicy?: restate.RestateUtils.RetrySettings
  ): Promise<T> {
    return this.ctx.sideEffect(fn, retryPolicy);
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

  rpc<M>(opts: restate.ServiceApi<M>): restate.Client<M> {
    return this.ctx.rpc(opts);
  }
  send<M>(opts: restate.ServiceApi<M>): restate.SendClient<M> {
    return this.ctx.send(opts);
  }
  sendDelayed<M>(
    opts: restate.ServiceApi<M>,
    delay: number
  ): restate.SendClient<M> {
    return this.ctx.sendDelayed(opts, delay);
  }
}

// ----------------------------------------------------------------------------
//               the service that wraps the workflow methods
// ----------------------------------------------------------------------------

export function createWrapperService<R, T, M>(
  workflow: wf.Workflow<R, T, M>,
  path: string,
  stateServiceApi: restate.ServiceApi<wss.api>
) {
  const wrapperService = {
    submit: async (
      ctx: restate.Context,
      request: wf.WorkflowRequest<T>
    ): Promise<wf.WorkflowStartResult> => {
      checkRequestAndWorkflowId(request);

      const started = await ctx
        .rpc(stateServiceApi)
        .startWorkflow(request.workflowId);
      if (started === wf.WorkflowStartResult.STARTED) {
        ctx.send(wrapperServiceApi).run(request);
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
          .rpc(stateServiceApi)
          .finishOrFailWorkflow(request.workflowId, { value: resultValue });
        return result;
      } catch (err) {
        const msg = stringifyError(err);
        await ctx
          .rpc(stateServiceApi)
          .finishOrFailWorkflow(request.workflowId, { error: msg });
        throw err;
      } finally {
        ctx
          .sendDelayed(stateServiceApi, DEFAULT_RETENTION_PERIOD)
          .dispose(request.workflowId);
      }
    },

    waitForResult: async (
      ctx: restate.Context,
      request: wf.WorkflowRequest<unknown>
    ): Promise<R> => {
      checkRequestAndWorkflowId(request);

      const awakeable = ctx.awakeable<R>();
      await ctx
        .rpc(stateServiceApi)
        .subscribeResult(request.workflowId, awakeable.id);
      return awakeable.promise;
    },

    status: async (
      ctx: restate.Context,
      request: wf.WorkflowRequest<unknown>
    ): Promise<wf.LifecycleStatus> => {
      checkRequestAndWorkflowId(request);
      return ctx.rpc(stateServiceApi).getStatus(request.workflowId);
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

  const wrapperServiceRouter = restate.router(wrapperService);
  const wrapperServiceApi: restate.ServiceApi<typeof wrapperServiceRouter> = {
    path,
  };

  return wrapperServiceRouter;
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
