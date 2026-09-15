/*
 * Copyright (c) 2023-2025 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

// Run a `@tanstack/workflow-core` WorkflowDefinition on Restate.
//
// This is a runtime adapter, not a host adapter. It does NOT use TanStack's
// `runWorkflow` / `RunStore` (that would keep the TanStack replay engine as the
// executor and reduce Restate to a key-value store). Each workflow is registered
// as a Restate Virtual Object keyed by `runId`, and the TanStack `BaseCtx` is
// built on top of a Restate ObjectContext. So `ctx.step` becomes a real Restate
// journal entry, `ctx.sleep` a Restate timer, and `waitForEvent` / `approve`
// become awakeables resolved by name through the shared handlers.
//
// The import below is the WebAssembly-free SDK entry, bundled into this package.
// See tsdown.config.ts for why it must stay that way.
import {
  createEndpointHandler,
  handlers,
  object,
  TerminalError,
} from "@restatedev/restate-sdk/lite/fetch";
import type {
  FetchEndpointOptions,
  ObjectContext,
  ObjectSharedContext,
  RunOptions,
} from "@restatedev/restate-sdk/lite/fetch";
import type {
  AnyWorkflowDefinition,
  ApprovalResult,
  ApproveOptions,
  BaseCtx,
  SleepOptions,
  StepContext,
  StepOptions,
  WaitForEventOptions,
  WorkflowRuntimeContext,
} from "@tanstack/workflow-core";
import type { AnyCtx } from "./middleware.js";
import {
  buildInitialState,
  composeMiddlewares,
  validateStandard,
  validateWorkflowInput,
  validateWorkflowOutput,
} from "./middleware.js";

// Object-state keys used only for adapter bookkeeping, mapping a pending
// wait/approval to the awakeable id that resumes it. Kept separate from the
// TanStack handler's in-memory `ctx.state`.
const awaitKey = (name: string) => `await:${name}`;
const approvalKey = (id: string) => `approval:${id}`;

/**
 * The runtime budget helpers are no-ops under Restate: it auto-suspends on
 * awaits and does not run bounded execution slices, so there is nothing to yield
 * and time is effectively unbounded.
 */
const unboundedRuntime: WorkflowRuntimeContext = {
  deadline: undefined,
  timeRemaining: () => Infinity,
  shouldYield: () => false,
  yield: async () => {},
};

function toRunOptions<T>(
  retry: StepOptions["retry"] | undefined
): RunOptions<T> {
  const options: RunOptions<T> = {};
  if (!retry) return options;
  options.maxRetryAttempts = retry.maxAttempts;
  if (retry.baseMs != null) options.initialRetryInterval = retry.baseMs;
  if (retry.backoff === "fixed") options.retryIntervalFactor = 1;
  // 'exponential' maps to the Restate default factor of 2. Custom function
  // backoff and per-attempt `timeout` have no direct Restate equivalent.
  return options;
}

/** Build the TanStack `BaseCtx` backed by a Restate ObjectContext. */
function buildBaseCtx(
  ctx: ObjectContext,
  def: AnyWorkflowDefinition,
  input: unknown,
  state: Record<string, unknown>
): BaseCtx<unknown, Record<string, unknown>> {
  const runId = ctx.key;
  // A run-level AbortSignal is part of the TanStack ctx contract. Restate owns
  // cancellation, so we hand out a controller that never fires.
  const abort = new AbortController();

  const step = <T>(
    id: string,
    fn: (stepCtx: StepContext) => T | Promise<T>,
    options?: StepOptions
  ): Promise<T> => {
    const retry = options?.retry ?? def.defaultStepRetry;
    const stepCtx: StepContext = {
      // Deterministic idempotency-key candidate for external systems, stable
      // across retries and replays, matching the TanStack guarantee.
      id: `${runId}:${id}`,
      attempt: 1, // Restate manages retries opaquely; attempt is best-effort.
      runtime: unboundedRuntime,
      signal: abort.signal,
    };
    return ctx.run<T>(
      id,
      async () => {
        try {
          return await fn(stepCtx);
        } catch (err) {
          // Honour a `shouldRetry` predicate by converting a non-retryable error
          // into a TerminalError, which stops the Restate retry loop.
          if (retry?.shouldRetry && !retry.shouldRetry(err, stepCtx.attempt)) {
            throw new TerminalError(
              err instanceof Error ? err.message : String(err)
            );
          }
          throw err;
        }
      },
      toRunOptions<T>(retry)
    );
  };

  const sleep = async (ms: number, _options?: SleepOptions): Promise<void> => {
    await ctx.sleep(ms);
  };

  const sleepUntil = async (
    timestamp: number,
    _options?: SleepOptions
  ): Promise<void> => {
    const delta = timestamp - (await ctx.date.now());
    if (delta > 0) await ctx.sleep(delta);
  };

  const waitForEvent = async <TPayload = unknown>(
    name: string,
    options?: WaitForEventOptions<TPayload>
  ): Promise<TPayload> => {
    const slot = awaitKey(options?.id ?? name);
    const awk = ctx.awakeable<TPayload>();
    // Persist the awakeable id so the shared `signal` handler can resolve it by
    // name. Committed before the run suspends on `awk.promise`.
    ctx.set(slot, awk.id);
    const pending =
      options?.deadline != null
        ? awk.promise.orTimeout(
            Math.max(options.deadline - (await ctx.date.now()), 0)
          )
        : awk.promise;
    let payload: TPayload;
    try {
      payload = await pending;
    } finally {
      ctx.clear(slot);
    }
    if (options?.schema) {
      return validateStandard(
        options.schema,
        payload,
        `waitForEvent("${name}")`
      ) as TPayload;
    }
    return payload;
  };

  const approve = async (options: ApproveOptions): Promise<ApprovalResult> => {
    const approvalId = options.id ?? ctx.rand.uuidv4();
    const slot = approvalKey(approvalId);
    const awk = ctx.awakeable<{ approved: boolean; feedback?: string }>();
    ctx.set(slot, awk.id);
    // Surface the pending approval so an operator knows what to resolve. A
    // production deployment would persist this via a step to an app-side inbox.
    ctx.console.info(
      `[approval-requested] run=${runId} approvalId=${approvalId} title=${options.title}`
    );
    let decision: { approved: boolean; feedback?: string };
    try {
      decision = await awk.promise;
    } finally {
      ctx.clear(slot);
    }
    return {
      approved: decision.approved,
      approvalId,
      feedback: decision.feedback,
    };
  };

  const now = async (): Promise<number> => ctx.date.now();
  const uuid = (): Promise<string> => Promise.resolve(ctx.rand.uuidv4());
  const emit = (name: string, value: Record<string, unknown>): void => {
    ctx.console.info(`[emit] ${name}`, value);
  };

  return {
    runId,
    input,
    state,
    signal: abort.signal,
    runtime: unboundedRuntime,
    step,
    sleep,
    sleepUntil,
    waitForEvent,
    approve,
    now,
    uuid,
    emit,
  };
}

/** Payload accepted by a workflow object's shared `signal` handler. */
export interface RestateWorkflowSignal {
  /** Name passed to `ctx.waitForEvent(name)`, or `options.id` if provided. */
  name: string;
  payload?: unknown;
}

/** Payload accepted by a workflow object's shared `approve` handler. */
export interface RestateWorkflowApproval {
  approvalId: string;
  approved: boolean;
  feedback?: string;
}

/**
 * The exclusive `run` handler: drive the TanStack handler on Restate.
 *
 * Exported so it can be unit tested against a stand-in ObjectContext without
 * standing up an endpoint.
 */
export async function runHandler(
  def: AnyWorkflowDefinition,
  ctx: ObjectContext,
  rawInput: unknown
): Promise<unknown> {
  const input = validateWorkflowInput(def, rawInput);
  const state = buildInitialState(def, input);
  const baseCtx = buildBaseCtx(ctx, def, input, state);
  const output = await composeMiddlewares(
    def.middlewares,
    baseCtx as AnyCtx,
    def.handler as (ctx: AnyCtx) => Promise<unknown>
  );
  return validateWorkflowOutput(def, output);
}

/** Shared `signal` handler: resolve a pending `waitForEvent` by name. */
export async function signalHandler(
  ctx: ObjectSharedContext,
  arg: RestateWorkflowSignal
): Promise<void> {
  const id = await ctx.get<string>(awaitKey(arg.name));
  if (!id) {
    throw new TerminalError(
      `No pending waitForEvent named "${arg.name}" for run ${ctx.key}`
    );
  }
  ctx.resolveAwakeable(id, arg.payload);
}

/** Shared `approve` handler: resolve a pending `approve` by approvalId. */
export async function approveHandler(
  ctx: ObjectSharedContext,
  arg: RestateWorkflowApproval
): Promise<void> {
  const id = await ctx.get<string>(approvalKey(arg.approvalId));
  if (!id) {
    throw new TerminalError(
      `No pending approval "${arg.approvalId}" for run ${ctx.key}`
    );
  }
  ctx.resolveAwakeable(id, { approved: arg.approved, feedback: arg.feedback });
}

/**
 * Turn a TanStack `WorkflowDefinition` into a Restate Virtual Object keyed by
 * `runId`, exposing three handlers:
 *
 *   - `run` (exclusive) drives the workflow handler on Restate.
 *   - `signal` (shared) resolves a pending `waitForEvent` by name.
 *   - `approve` (shared) resolves a pending `approve` by approvalId.
 *
 * The object takes its name from the workflow's `id`.
 */
export function restateWorkflow(def: AnyWorkflowDefinition) {
  return object({
    name: def.id,
    handlers: {
      run: (ctx: ObjectContext, rawInput: unknown) =>
        runHandler(def, ctx, rawInput),
      signal: handlers.object.shared(signalHandler),
      approve: handlers.object.shared(approveHandler),
    },
  });
}

/**
 * Options for {@link createWorkflowEndpoint}. Everything
 * {@link FetchEndpointOptions} accepts is supported except `services`, which is
 * derived from `workflows`.
 */
export interface WorkflowEndpointOptions extends Omit<
  FetchEndpointOptions,
  "services"
> {
  /** TanStack workflow definitions to expose, one Virtual Object each. */
  workflows: ReadonlyArray<AnyWorkflowDefinition>;
}

/**
 * Build a `fetch` handler serving the given TanStack workflows over Restate.
 *
 * This is the entry point for fetch-based hosts such as Cloudflare Workers,
 * Deno, Bun and Vercel.
 *
 * @example
 * ```ts
 * export default {
 *   fetch: createWorkflowEndpoint({ workflows: [checkout] }),
 * };
 * ```
 */
export function createWorkflowEndpoint(
  options: WorkflowEndpointOptions
): (request: Request, ...extraArgs: unknown[]) => Promise<Response> {
  const { workflows, ...endpointOptions } = options;
  return createEndpointHandler({
    ...endpointOptions,
    services: workflows.map((def) => restateWorkflow(def)),
  });
}
