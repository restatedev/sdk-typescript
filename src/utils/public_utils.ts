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
 * Each delay is twice as long as the previous delay.
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
   * The initial delay between retries. As more retries happen, the delay may change per the policy.
   */
  initialDelayMs?: number;

  /**
   * Optionally, the maximum delay between retries. No matter what the policy says, this is the maximum time
   * that Restate sleeps between retries.
   * If not set, there is effectively no limit (internally the limit is Number.MAX_SAFE_INTEGER).
   */
  maxDelayMs?: number;

  /**
   * Optionally, the maximum number of retries before this function fails with an exception.
   * If not set, there is effectively no limit (internally the limit is Number.MAX_SAFE_INTEGER).
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
 * The default initial delay between retries: 10 milliseconds.
 */
export const DEFAULT_INITIAL_DELAY_MS = 10;

/**
 * Default retry policy that retries an infinite number of times, with exponential backoff
 * and a starting delay of 10 milliseconds.
 */
export const DEFAULT_INFINITE_EXPONENTIAL_BACKOFF: RetrySettings = {
  initialDelayMs: DEFAULT_INITIAL_DELAY_MS,
  maxDelayMs: Number.MAX_SAFE_INTEGER,
  maxRetries: Number.MAX_SAFE_INTEGER,
  policy: EXPONENTIAL_BACKOFF,
};

/**
 * Retry policy that does no retries.
 */
export const NO_RETRIES: RetrySettings = { maxRetries: 0 };
