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

// Like https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/withResolvers
// (not yet available in node)
export class CompletablePromise<T> {
  private success!: (value: T | PromiseLike<T>) => void;
  private failure!: (reason?: unknown) => void;

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

  public reject(reason?: unknown) {
    this.failure(reason);
  }
}
