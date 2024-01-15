/*
 * Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

// -- Wrapped promise

/* eslint-disable @typescript-eslint/no-explicit-any */
export type WrappedPromise<T> = Promise<T> & {
  // The reason for this transform is that we want to retain the wrapping.
  // When working with WrappedPromise you MUST use this method instead of then for mapping the promise results.
  transform: <TResult1 = T, TResult2 = never>(
    onfulfilled?:
      | ((value: T) => TResult1 | PromiseLike<TResult1>)
      | null
      | undefined,
    onrejected?:
      | ((reason: any) => TResult2 | PromiseLike<TResult2>)
      | null
      | undefined
  ) => Promise<TResult1 | TResult2>;
};

export function wrapDeeply<T>(
  promise: Promise<T>,
  onThen?: () => void
): WrappedPromise<T> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return {
    transform: function <TResult1 = T, TResult2 = never>(
      onfulfilled?:
        | ((value: T) => TResult1 | PromiseLike<TResult1>)
        | null
        | undefined,
      onrejected?:
        | ((reason: any) => TResult2 | PromiseLike<TResult2>)
        | null
        | undefined
    ): Promise<TResult1 | TResult2> {
      return wrapDeeply(promise.then(onfulfilled, onrejected), onThen);
    },

    then: function <TResult1 = T, TResult2 = never>(
      onfulfilled?:
        | ((value: T) => TResult1 | PromiseLike<TResult1>)
        | null
        | undefined,
      onrejected?:
        | ((reason: any) => TResult2 | PromiseLike<TResult2>)
        | null
        | undefined
    ): Promise<TResult1 | TResult2> {
      if (onThen !== undefined) {
        onThen();
      }
      return promise.then(onfulfilled, onrejected);
    },
    catch: function <TResult = never>(
      onrejected?:
        | ((reason: any) => TResult | PromiseLike<TResult>)
        | null
        | undefined
    ): Promise<T | TResult> {
      return wrapDeeply(promise.catch(onrejected), onThen);
    },
    finally: function (
      onfinally?: (() => void) | null | undefined
    ): Promise<T> {
      return wrapDeeply(promise.finally(onfinally), onThen);
    },
    [Symbol.toStringTag]: "",
  };
}

// Like https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/withResolvers
// (not yet available in node)
export class CompletablePromise<T> {
  private success!: (value: T | PromiseLike<T>) => void;
  private failure!: (reason?: any) => void;

  public readonly promise: Promise<T>;

  constructor() {
    this.promise = new Promise((resolve, reject) => {
      this.success = resolve;
      this.failure = reject;
    });
  }

  public resolve(value: T) {
    this.success(value);
  }

  public reject(reason?: any) {
    this.failure(reason);
  }
}

// A promise that is never completed
// eslint-disable-next-line @typescript-eslint/no-empty-function
export const PROMISE_PENDING: Promise<any> = new Promise<any>(() => {});
export const WRAPPED_PROMISE_PENDING: Promise<any> =
  wrapDeeply(PROMISE_PENDING);
