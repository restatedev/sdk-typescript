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

import { describe, expect } from "@jest/globals";
import {
  CompletablePromise,
  wrapDeeply,
  WrappedPromise,
} from "../src/utils/promises";
import {
  newJournalEntryPromiseId,
  PromiseCombinatorTracker,
  PromiseId,
} from "../src/promise_combinator_tracker";

describe("promises.wrapDeeply", () => {
  it("should support nested wrapping", async () => {
    const callbackInvokeOrder: number[] = [];
    const completablePromise = new CompletablePromise();

    let p = completablePromise.promise;
    p = wrapDeeply(p, () => {
      callbackInvokeOrder.push(2);
    });
    p = wrapDeeply(p, () => {
      callbackInvokeOrder.push(1);
    });
    p = (p as WrappedPromise<any>).transform((v) => v + " transformed");

    completablePromise.resolve("my value");

    expect(await p).toStrictEqual("my value transformed");
    expect(callbackInvokeOrder).toStrictEqual([1, 2]);
  });
});
