/*
 * Copyright (c) 2023-2026 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

/** FIFO queue with O(1) amortized `shift`, unlike `Array.prototype.shift`. */
export class Queue<T> {
  #items: (T | undefined)[] = [];
  #head = 0;

  get length(): number {
    return this.#items.length - this.#head;
  }

  push(item: T): void {
    this.#items.push(item);
  }

  peek(): T | undefined {
    return this.#items[this.#head];
  }

  shift(): T | undefined {
    if (this.#head === this.#items.length) {
      return undefined;
    }
    const item = this.#items[this.#head];
    this.#items[this.#head] = undefined;
    this.#head++;
    if (this.#head === this.#items.length) {
      this.#items = [];
      this.#head = 0;
    } else if (this.#head >= 1024 && this.#head * 2 >= this.#items.length) {
      this.#items = this.#items.slice(this.#head);
      this.#head = 0;
    }
    return item;
  }

  /** Removes and returns every item. */
  drain(): T[] {
    const items = this.#items.slice(this.#head) as T[];
    this.#items = [];
    this.#head = 0;
    return items;
  }
}
