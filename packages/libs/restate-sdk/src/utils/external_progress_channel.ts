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

/**
 * Multi-producer single-consumer unit-signal channel used to wake the
 * {@link PromisesExecutor} when any external progress source (input read or
 * run-closure completion) has made progress.
 *
 * Producers call {@link signal} to emit a progress event.
 * The single consumer calls {@link awaitNext} to await the next signal.
 *
 * Signals emitted with no consumer waiting are buffered, so no progress signal
 * is ever lost. At most one {@link awaitNext} may be pending at a time; a
 * concurrent second call rejects.
 */
export class ExternalProgressChannel {
  private pending = 0;
  private waiter: (() => void) | undefined;

  signal(): void {
    if (this.waiter !== undefined) {
      const w = this.waiter;
      this.waiter = undefined;
      w();
    } else {
      this.pending++;
    }
  }

  awaitNext(): Promise<void> {
    if (this.waiter !== undefined) {
      return Promise.reject(new Error("awaitNext already pending"));
    }
    if (this.pending > 0) {
      this.pending--;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiter = resolve;
    });
  }
}
