import { Context, InvocationId, RestatePromise } from "./context.js";

export { isSuspendedError } from "./types/errors.js";

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
   *       ctxInternal = ctx as restate.ContextInternal;
   *       const result = await Promise.race([
   *         ctx.run(() => longRunningTask(name)),
   *         ctxInternal.cancellation().then(() => { throw new restate.TerminalError("Cancelled") }),
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
   * greet: async (ctx: restate.Context, name: string) => {
   *   const ctxInternal = ctx as restate.ContextInternal;
   *   const result = await ctx.run(() => {
   *     const controller = new AbortController();
   *     ctxInternal.cancellation().then(() => controller.abort());
   *     return fetch(`https://api.example.com/greet/${name}`, { signal: controller.signal });
   *   });
   *   return result;
   * }
   * ```
   *
   * @example Handle cancellation, perform cleanup, then listen for the next cancellation
   * ```ts
   * greet: async (ctx: restate.Context, name: string) => {
   *   const ctxInternal = ctx as restate.ContextInternal;
   *   try {
   *     const result = await Promise.race([
   *       ctx.run(() => longRunningTask(name)),
   *       ctxInternal.cancellation().then(() => { throw new restate.TerminalError("Cancelled") }),
   *     ]);
   *     return result;
   *   } catch (e) {
   *     // Perform cleanup
   *     await ctx.run(() => cleanupResources(name));
   *
   *     // After cancellation is resolved, ctx.cancellation() returns a fresh promise.
   *     // Race cleanup confirmation against the next cancellation signal.
   *     await Promise.race([
   *       ctx.run(() => confirmCleanup(name)),
   *       ctxInternal.cancellation().then(() => { throw new restate.TerminalError("Canceled during cleanup") }),
   *     ]);
   *   }
   * }
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
}
