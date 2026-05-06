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

import {
  object,
  handlerRequest,
  client,
  sendClient,
  state,
  sleep,
} from "@restatedev/restate-sdk-gen";
import { counterObject } from "./counter.js";

const invokeCounts = new Map<string, number>();

function doLeftAction(k: string): boolean {
  const next = (invokeCounts.get(k) ?? 0) + 1;
  invokeCounts.set(k, next);
  return next % 2 === 1;
}

export const nonDeterministic = object({
  name: "NonDeterministic",
  handlers: {
    *setDifferentKey() {
      if (doLeftAction(handlerRequest().key!)) {
        state().set("a", "my-state");
      } else {
        state().set("b", "my-state");
      }
      yield* sleep(100);
      sendClient(counterObject, handlerRequest().key!).add(1);
    },

    *backgroundInvokeWithDifferentTargets() {
      if (doLeftAction(handlerRequest().key!)) {
        sendClient(counterObject, "abc").get();
      } else {
        sendClient(counterObject, "abc").reset();
      }
      yield* sleep(100);
      sendClient(counterObject, handlerRequest().key!).add(1);
    },

    *callDifferentMethod() {
      if (doLeftAction(handlerRequest().key!)) {
        yield* client(counterObject, "abc").get();
      } else {
        yield* client(counterObject, "abc").reset();
      }
      yield* sleep(100);
      sendClient(counterObject, handlerRequest().key!).add(1);
    },

    *eitherSleepOrCall() {
      if (doLeftAction(handlerRequest().key!)) {
        yield* sleep(100);
      } else {
        yield* client(counterObject, "abc").get();
      }
      yield* sleep(100);
      sendClient(counterObject, handlerRequest().key!).add(1);
    },
  },
});
