"use strict";

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-inferrable-types */
import { rlog } from "../utils/logger";
import { RestateContext } from "../restate_context";
import { RestateError } from "../types/errors";

/**
 * Retry policy that decides how to delay between retries.
 */
export interface RetryPolicy {
  computeNextDelay(previousDelayMs: number): number;
}

/**
 * A {@link RetryPolicy} that keeps a fixed delay between retries.
 */
export const FIXED_DELAY: RetryPolicy = {
  computeNextDelay(previousDelayMs: number): number {
    return previousDelayMs;
  },
};

/**
 * A {@link RetryPolicy} that does an exponential backoff delay between retries.
 * Each delay is double the previous delay.
 */
export const EXPONENTIAL_BACKOFF: RetryPolicy = {
  computeNextDelay(previousDelayMs: number): number {
    return 2 * previousDelayMs;
  },
};

/**
 * All properties related to retrying, like the policy (exponential, fixed, ...), the
 * initial delay, the maximum number of retries.
 */
export interface RetrySettings {
  /**
   * The initial delay between retries. As more retries happen, the delay may chance per the policy.
   */
  initialDelayMs: number;

  /**
   * Optionally, the maximum delay between retries. No matter what the policy says, this is the maximum time
   * that Restate sleeps between retries.
   * If not set, there is is effectively no limit (internally the limit is Number.MAX_SAFE_INTEGER).
   */
  maxDelayMs?: number;

  /**
   * Optionally, the maximum number of retries before this function fails with an exception.
   * If not set, there is is effectively no limit (internally the limit is Number.MAX_SAFE_INTEGER).
   */
  maxRetries?: number;

  /**
   * Optionally, the {@link RetryPolicy} to use. Defaults to {@link EXPONENTIAL_BACKOFF}.
   */
  policy?: RetryPolicy;

  /**
   * Optionally, the name of side effect action that is used in error- and log messages around retries.
   */
  name?: string;
}

/**
 * Calls a side effect function and retries when the result is false, with a timed backoff.
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
 * await retrySideEffect(ctx, paymentAction, {initialDelayMs: 1000, maxRetries: 10});
 *
 * @param ctx              The RestateContext object to call the side effect to sleep on.
 * @param retrySettings    Settings for the retries, like delay, attempts, etc.
 * @param sideEffect       The side effect action to run.
 *
 * @returns A promises that resolves successfully when the side effect completed successfully,
 *          and rejected if the side effect fails or the maximum retries are exhausted.
 */
export async function retrySideEffect(
  ctx: RestateContext,
  retrySettings: RetrySettings,
  sideEffect: () => Promise<boolean>
): Promise<void> {
  const {
    initialDelayMs,
    maxDelayMs = Number.MAX_SAFE_INTEGER,
    maxRetries = Number.MAX_SAFE_INTEGER,
    policy = EXPONENTIAL_BACKOFF,
    name = "retryable-side-effect",
  } = retrySettings;

  let currentDelayMs = initialDelayMs;
  let retriesLeft = maxRetries;

  while (!(await ctx.sideEffect(sideEffect))) {
    rlog.debug("Unsuccessful execution of side effect '%s'.", name);
    if (retriesLeft > 0) {
      rlog.debug("Retrying in %d ms", currentDelayMs);
    } else {
      rlog.debug("No retries left.");
      throw new RestateError(`Retries exhausted for '${name}'.`);
    }

    await ctx.sleep(currentDelayMs);

    retriesLeft -= 1;
    currentDelayMs = Math.min(
      policy.computeNextDelay(currentDelayMs),
      maxDelayMs
    );
  }
}

/**
 * Calls a side effect function and retries the call on failure, with a timed backoff.
 * The side effect function is retried when it throws an Error, until returns a successfully
 * resolved Promise.
 *
 * Between retries, this function will do a suspendable Restate sleep.
 * The sleep time starts with the 'initialDelayMs' value and doubles on each retry, up to
 * a maximum of maxDelayMs.
 *
 * The returned Promise will be resolved successfully once the side effect action completes
 * successfully and will be rejected with an error if the maximum number of retries
 * (as specified by 'maxRetries') is exhausted.
 *
 * @example
 * const ctx = restate.useContext(this);
 * const paymentAction = async () => {
 *   const result = await paymentClient.call(txId, methodIdentifier, amount);
 *   if (result.error) {
 *     throw result.error;
 *   } else {
 *     return result.payment_accepted;
 *   }
 * }
 * const paymentAccepted: boolean =
 *   await retryExceptionalSideEffectWithBackoff(ctx, paymentAction, {initialDelayMs: 1000, maxRetries: 10});
 *
 * @param ctx              The RestateContext object to call the side effect to sleep on.
 * @param retrySettings    Settings for the retries, like delay, attempts, etc.
 * @param sideEffect       The side effect action to run.
 *
 * @returns A promises that resolves successfully when the side effect completed,
 *          and rejected if the retries are exhausted.
 */
export async function retryExceptionalSideEffect<T>(
  ctx: RestateContext,
  retrySettings: RetrySettings,
  sideEffect: () => Promise<T>
): Promise<T> {
  const {
    initialDelayMs,
    maxDelayMs = Number.MAX_SAFE_INTEGER,
    maxRetries = Number.MAX_SAFE_INTEGER,
    policy = EXPONENTIAL_BACKOFF,
    name = "retryable-side-effect",
  } = retrySettings;

  let currentDelayMs = initialDelayMs;
  let retriesLeft = maxRetries;
  let lastError: Error | null = null;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await ctx.sideEffect(sideEffect);
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
        rlog.debug("Retrying in %d ms", currentDelayMs);
      } else {
        rlog.debug("No retries left.");
        throw new RestateError(`Retries exhausted for ${name}.`, lastError);
      }
    }

    await ctx.sleep(currentDelayMs);

    retriesLeft -= 1;
    currentDelayMs = Math.min(
      policy.computeNextDelay(currentDelayMs),
      maxDelayMs
    );
  }
}

// ----------------------------------------------------------------------------
//  deprecated versions, for compatibility
// ----------------------------------------------------------------------------

/**
 * @deprecated
 *
 * Use {@link retrySideEffect} instead.
 */
export async function retrySideEffectWithBackoff(
  ctx: RestateContext,
  sideEffectAction: () => Promise<boolean>,
  initialDelayMs: number,
  maxDelayMs: number,
  maxRetries: number = 2147483647,
  name: string = "unnamed-retryable-side-effect"
): Promise<void> {
  return retrySideEffect(
    ctx,
    {
      initialDelayMs,
      maxDelayMs,
      maxRetries,
      name,
      policy: EXPONENTIAL_BACKOFF,
    },
    sideEffectAction
  );
}

/**
 * @deprecated
 *
 * Use {@link retryExceptionalSideEffect} instead.
 */
export async function retryExceptionalSideEffectWithBackoff<T>(
  ctx: RestateContext,
  sideEffectAction: () => Promise<T>,
  initialDelayMs: number,
  maxDelayMs: number,
  maxRetries: number = 2147483647,
  name: string = "unnamed-retryable-side-effect"
): Promise<T> {
  return retryExceptionalSideEffect(
    ctx,
    {
      initialDelayMs,
      maxDelayMs,
      maxRetries,
      name,
      policy: EXPONENTIAL_BACKOFF,
    },
    sideEffectAction
  );
}
