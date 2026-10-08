import { Context, InvocationId, RestatePromise } from "./context.js";
import type { Serde } from "@restatedev/restate-sdk-core";

export { isSuspendedError } from "./types/errors.js";

/**
 * Downcast the given context to {@link ContextInternal}, to access the internal APIs.
 *
 * Works with every context type passed to handlers, e.g. `Context`, `ObjectContext`, `ObjectSharedContext`, `WorkflowContext`.
 *
 * @example
 * ```ts
 * const ctxInternal = restate.internal.asInternal(ctx);
 * ```
 *
 * @experimental
 */
export function asInternal(ctx: Context): ContextInternal {
  return ctx as ContextInternal;
}

/**
 * Internal {@link Context} interface exposing additional features.
 *
 * Please note that this API is to be considered experimental and might change without notice.
 *
 * @experimental
 */
export interface ContextInternal extends Context {
  /**
   * Returns true if the handler is in the processing phase.
   * This is the mechanism used by `ctx.console` to distinguish whether we should log or not in replaying/processing.
   *
   * **WARNING**: This method should not be used to influence control flow, as it will **surely** lead to non-determinism errors!
   *
   * @experimental
   */
  isProcessing(): boolean;

  /**
   * Returns a {@link RestatePromise} that resolves with `undefined` when Restate signals cancellation
   * of the current invocation.
   *
   * This method **MUST** only be used when the handler (or its parent service/endpoint) is configured
   * with `explicitCancellation: true`. Without configuring this option, cancellations are propagated automatically,
   * and this promise will **NEVER** resolve.
   *
   * **Promise reuse:** calling this method multiple times returns the **same** promise instance as long as
   * the current cancellation signal has not yet arrived. Once the promise resolves (cancellation received),
   * later calls return a **new** promise that will resolve on the next cancellation signal.
   *
   * @example Race a long-running side effect against cancellation
   * ```ts
   * const greeter = restate.service({
   *   name: "greeter",
   *   handlers: {
   *     greet: async (ctx: restate.Context, name: string) => {
   *       const ctxInternal = restate.internal.asInternal(ctx);
   *       const result = await RestatePromise.race([
   *         ctx.run(() => longRunningTask(name)),
   *         ctxInternal.cancellation().map(() => { throw new restate.TerminalError("Cancelled") }),
   *       ]);
   *       return result;
   *     },
   *   },
   *   options: { explicitCancellation: true },
   * });
   * ```
   *
   * @example Use the cancellation promise to create an AbortSignal for ctx.run
   * ```ts
   * const greeter = restate.service({
   *   name: "greeter",
   *   handlers: {
   *     greet: async (ctx: restate.Context, name: string) => {
   *       const ctxInternal = restate.internal.asInternal(ctx);
   *       const controller = new AbortController();
   *       const cancellation = ctxInternal.cancellation()
   *         .map(() => {
   *            controller.abort();
   *            throw new restate.TerminalError("Cancelled");
   *         });
   *
   *       return RestatePromise.race([
   *         ctx.run(() => fetch(`https://api.example.com/greet/${name}`, { signal: controller.signal })),
   *         cancellation,
   *       ]);
   *     },
   *   },
   *   options: { explicitCancellation: true },
   * });
   * ```
   *
   * @example Handle cancellation, perform cleanup, then listen for the next cancellation
   * ```ts
   * const greeter = restate.service({
   *   name: "greeter",
   *   handlers: {
   *     greet: async (ctx: restate.Context, name: string) => {
   *       const ctxInternal = restate.internal.asInternal(ctx);
   *       try {
   *         return await RestatePromise.race([
   *           ctx.run(() => longRunningTask(name)),
   *           ctxInternal.cancellation().map(() => { throw new restate.TerminalError("Cancelled") }),
   *         ]);
   *       } catch (e) {
   *         // Perform cleanup
   *         await ctx.run(() => cleanupResources(name));
   *
   *         // After cancellation is resolved, ctx.cancellation() returns a fresh promise.
   *         // Race cleanup confirmation against the next cancellation signal.
   *         await RestatePromise.race([
   *           ctx.run(() => confirmCleanup(name)),
   *           ctxInternal.cancellation().map(() => { throw new restate.TerminalError("Canceled during cleanup") }),
   *         ]);
   *       }
   *     },
   *   },
   *   options: { explicitCancellation: true },
   * });
   * ```
   *
   * @experimental
   */
  cancellation(): RestatePromise<void>;

  /**
   * Cancel all previous calls made from this handler.
   *
   * This method **MUST** only be used when the handler (or its parent service/endpoint) is configured
   * with `explicitCancellation: true`. Without configuring this option, this operation will always be a no-op.
   *
   * @return the invocation id of the canceled calls.
   * @experimental
   */
  cancelPreviousCalls(): RestatePromise<InvocationId[]>;

  /**
   * Get state from the Restate runtime, apply the given `projection` to it,
   * and record in the journal only the result of the projection.
   *
   * Use this to read big state values when you need only a small part of them:
   * unlike `ctx.get`, the complete state value is not recorded in the journal,
   * only its projection.
   *
   * It will appear in the UI as run(project:state_key).
   *
   * This method **MUST** only be used within Virtual Object and Workflow handlers.
   *
   * **NOTE:** Requires Restate >= 1.8 with service protocol V8 enabled, and **does not** work with request/response protocol mode (e.g. with AWS Lambda).
   *
   * @param name key of the state to retrieve
   * @param projection function receiving the state value, or `null` if the state is empty.
   * @param options serde for the state value, and serde for the projection result.
   * @returns a {@link RestatePromise} resolved with the result of the projection.
   *
   * @example
   * ```ts
   * const ctxInternal = restate.internal.asInternal(ctx);
   * const itemsCount = await ctxInternal.getProject<Item[], number>(
   *   "items",
   *   (items) => items?.length ?? 0
   * );
   * ```
   *
   * @experimental
   */
  getProject<TValue, TResult>(
    name: string,
    projection: (value: TValue | null) => TResult | Promise<TResult>,
    options?: GetProjectOptions<TValue, TResult>
  ): RestatePromise<TResult>;
}

/**
 * Options for {@link ContextInternal.getProject}.
 *
 * @experimental
 */
export type GetProjectOptions<TValue, TResult> = {
  /**
   * Serde used to deserialize the state value.
   */
  serde?: Serde<TValue>;

  /**
   * Serde used to serialize the projection result, recorded in the journal.
   *
   * If not set, defaults to {@link GetProjectOptions.serde} when that is set,
   * otherwise to the default serde.
   */
  resultSerde?: Serde<TResult>;
};
