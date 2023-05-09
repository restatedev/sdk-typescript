"use strict";

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-inferrable-types */
import { rlog } from "../utils/logger";
import { RestateContext } from "../restate_context";
import { RestateError } from "../types/errors";

/**
 * Calls a side effect function and retries the call on failure, with a timed backoff.
 * The side effect function is retried until it returns true or until it throws an error.
 *
 * Between retries, the call this function will do a suspendable Restate sleep.
 * The sleep time starts with the 'initialDelayMs' value and doubles on each retry, up to
 * a maximum of maxDelayMs.
 *
 * The returned Promise will be resolved successfully once the side effect actions completes
 * successfully and will be rejected with an error if
 *   (a) the side effect function throws an error
 *   (b) the maximum number of retries (as specified by 'maxRetries') is exhausted .
 *
 * @example
 * const ctx = restate.useContext(this);
 * const paymentAction = async () =>
 *   (await paymentClient.call(txId, methodIdentifier, amount)).success;
 * await retrySideEffectWithBackoff(ctx, paymentAction, 1000, 60000, 10);
 *
 * @param ctx              The RestateContext object to call the side effect to sleep on.
 * @param sideEffectAction The side effect action to run.
 * @param initialDelayMs   The initial number of milliseconds to wait before retrying.
 * @param maxDelayMs       The maxim number of milliseconds to wait between retries.
 * @param maxRetries       (Optional) The maximum number of retries before this function fails with an exception.
 * @param name             (Optional) The name of side effect action, to be used in log and error messages.
 *
 * @returns A promises that resolves successfully when the side effect completed successfully,
 *          and rejected if the side effect fails or the maximum retries are exhausted.
 */
export async function retrySideEffectWithBackoff(
  ctx: RestateContext,
  sideEffectAction: () => Promise<boolean>,
  initialDelayMs: number,
  maxDelayMs: number,
  maxRetries: number = 2147483647,
  name: string = "unnamed-retryable-side-effect"
): Promise<void> {
  let delayMs = initialDelayMs;
  let retriesLeft = maxRetries;

  while (!(await ctx.sideEffect(sideEffectAction))) {
    rlog.debug("Unsuccessful execution of side effect '%s'.", name);
    if (retriesLeft > 0) {
      rlog.debug("Retrying in %d ms", delayMs);
    } else {
      rlog.debug("No retries left.");
      throw new RestateError(`Retries exhaused for '${name}'.`);
    }

    await ctx.sleep(delayMs);

    retriesLeft -= 1;
    delayMs = Math.min(delayMs * 2, maxDelayMs);
  }
}

/**
 * Calls a side effect function and retries the call on failure, with a timed backoff.
 * The side effect function is retried when it throws an Error, until returns a successfully
 * resolved Promise.
 *
 * Between retries, the call this function will do a suspendable Restate sleep.
 * The sleep time starts with the 'initialDelayMs' value and doubles on each retry, up to
 * a maximum of maxDelayMs.
 *
 * The returned Promise will be resolved successfully once the side effect actions completes
 * successfully and will be rejected with an error if the maximum number of retries
 * (as specified by 'maxRetries') is exhausted .
 *
 * @example
 * const ctx = restate.useContext(this);
 * const paymentAction = async () => {
 *   const result = await paymentClient.call(txId, methodIdentifier, amount);
 *   if (result.error) {
 *     throw result.error;
 *   } else {
 *     return result.isSuccess;
 *   }
 * }
 * boolean paymentAccepted =
 *   await retryExceptionalSideEffectWithBackoff(ctx, paymentAction, 1000, 60000, 10);
 *
 * @param ctx              The RestateContext object to call the side effect to sleep on.
 * @param sideEffectAction The side effect action to run.
 * @param initialDelayMs   The initial number of milliseconds to wait before retrying.
 * @param maxDelayMs       The maxim number of milliseconds to wait between retries.
 * @param maxRetries       (Optional) The maximum number of retries before this function fails with an exception.
 * @param name             (Optional) The name of side effect action, to be used in log and error messages.
 *
 * @returns A promises that resolves successfully when the side effect completed,
 *          and rejected if the retries are exhausted.
 */
export async function retryExceptionalSideEffectWithBackoff<T>(
  ctx: RestateContext,
  sideEffectAction: () => Promise<T>,
  initialDelayMs: number,
  maxDelayMs: number,
  maxRetries: number = 2147483647,
  name: string = "unnamed-retryable-side-effect"
): Promise<T> {
  let delayMs = initialDelayMs;
  let retriesLeft = maxRetries;
  let lastError: Error | null = null;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await ctx.sideEffect(sideEffectAction);
    } catch (e) {
      let errorName: string;
      let errorMessage: string;

      if (e instanceof Error) {
        lastError = e;
        errorName = e.name;
        errorMessage = e.message;
      } else {
        lastError = new RestateError("Uncategorized error", e);
        errorName = "Error";
        errorMessage = JSON.stringify(e);
      }

      rlog.debug(
        "Error while executing side effect '%s': %s - %s",
        name,
        errorName,
        errorMessage
      );

      if (retriesLeft > 0) {
        rlog.debug("Retrying in %d ms", delayMs);
      } else {
        rlog.debug("No retries left.");
        throw new RestateError(`Retries exhaused for {name}`, lastError);
      }
    }

    await ctx.sleep(delayMs);

    retriesLeft -= 1;
    delayMs = Math.min(delayMs * 2, maxDelayMs);
  }
}
