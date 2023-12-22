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

export class TaskQueue {
    private next: Promise<void>;

    constructor() {
        this.next = Promise.resolve()
    }

    // Enqueue the task in the executor queue
    execute(f: () => Promise<void>) {
        this.next = this.next.finally(async () => {
            await f()
        });
    }

    // Enqueue the task in the executor queue and return back
    // the promise that gets resolved once this task is completed.
    executeAndNotify<T>(f: () => Promise<T>): Promise<T> {
        return new Promise((resolve, reject) => {
            this.next = this.next.finally(async () => {
                try {
                    resolve(await f())
                } catch (e) {
                    reject(e)
                }
            })
        });
    }

    async drain() {
        await this.next;
    }
}