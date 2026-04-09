import type { Serde } from "@restatedev/restate-sdk-core";
import { Context, InvocationId, RestatePromise } from "./context.js";
import type { TerminalError } from "./types/errors.js";

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
   *       ctxInternal = ctx as restate.internal.ContextInternal;
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
   *       const ctxInternal = ctx as restate.internal.ContextInternal;
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
   *       const ctxInternal = ctx as restate.internal.ContextInternal;
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
   * Wait for a named signal to arrive on the current invocation.
   *
   * Signals are identified by name and are scoped to the current invocation.
   * Another handler can send a signal to this invocation using
   * {@link InvocationReference.signal}, specifying this invocation's
   * ID (available via `ctx.request().id`) and the same signal name.
   *
   * @param name the name of the signal to wait for.
   * @param serde optional custom serializer/deserializer for the payload.
   * @returns a {@link RestatePromise} that resolves when the signal arrives.
   *
   * @example
   * const ctxInternal = ctx as restate.internal.ContextInternal;
   * const approved = await ctxInternal.signal<boolean>("approved");
   *
   * @experimental
   */
  signal<T>(name: string, serde?: Serde<T>): RestatePromise<T>;

  /**
   * Get a reference to a target invocation, to send signals to it.
   *
   * @param invocationId the invocation ID of the target invocation.
   * @returns an {@link InvocationReference} for the target invocation.
   *
   * @example
   * const ctxInternal = ctx as restate.internal.ContextInternal;
   * const target = ctxInternal.invocation(targetInvocationId);
   * target.signal("approved").resolve(true);
   * target.signal("approved").reject("Request denied");
   *
   * @experimental
   */
  invocation(invocationId: InvocationId): InvocationReference;
}

/**
 * A reference to a target invocation, used to send signals.
 *
 * @experimental
 */
export interface InvocationReference {
  /**
   * Get a handle to a named signal on the target invocation.
   *
   * @param name the name of the signal.
   * @param serde optional custom serializer/deserializer for the payload.
   * @returns a {@link SignalReference} to resolve or reject the signal.
   *
   * @experimental
   */
  signal<T>(name: string, serde?: Serde<T>): SignalReference<T>;

  /**
   * Cancel the target invocation.
   */
  cancel(): void;

  /**
   * Attach to the target invocation and wait for its result.
   *
   * @param serde optional custom serializer/deserializer for the result.
   * @returns a {@link RestatePromise} that resolves with the invocation result.
   */
  attach<T>(serde?: Serde<T>): RestatePromise<T>;
}

/**
 * A handle to send a signal value to a target invocation.
 *
 * @experimental
 */
export interface SignalReference<T> {
  /**
   * Resolve the signal with a value.
   *
   * @param payload the payload to send.
   *
   * @experimental
   */
  resolve(payload?: T): void;

  /**
   * Reject the signal. The target invocation waiting on this signal will be
   * woken up with a terminal error containing the provided reason.
   *
   * @param reason the reason for rejection, either a string message or a {@link TerminalError}.
   *
   * @experimental
   */
  reject(reason: string | TerminalError): void;
}
