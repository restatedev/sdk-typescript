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

import { ReadableStream } from "node:stream/web";

export function OnceStream<T>(once: T): ReadableStream<T> {
  return new ReadableStream<T>({
    pull: (controller) => {
      controller.enqueue(once);
      controller.close();
    },
  });
}
