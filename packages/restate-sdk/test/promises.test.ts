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

import type { WrappedPromise } from "../src/utils/promises.js";
import { CompletablePromise, wrapDeeply } from "../src/utils/promises.js";
import { describe, expect, it } from "vitest";

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
    p = (p as WrappedPromise<string>).transform((v) => v + " transformed");

    completablePromise.resolve("my value");

    expect(await p).toStrictEqual("my value transformed");
    expect(callbackInvokeOrder).toStrictEqual([1, 2]);
  });
});
