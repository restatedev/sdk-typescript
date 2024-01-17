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
import { CompletablePromise } from "../src/utils/promises";
import {
  newJournalEntryPromiseId,
  PromiseCombinatorTracker,
  PromiseId,
} from "../src/promise_combinator_tracker";

describe("PromiseCombinatorTracker with Promise.any", () => {
  it("should provide order in processing mode", async () => {
    const { completers, promises } = generateTestPromises(3);

    const testResultPromise = testCombinatorInProcessingMode(
      Promise.any.bind(Promise),
      promises
    );

    // Any doesn't return on first reject
    completers[0].reject("bla");
    completers[2].resolve("my value");

    const { order, result } = await testResultPromise;
    expect(result).toStrictEqual("my value");
    expect(order).toStrictEqual(createOrder(0, 2));
  });

  it("should provide order in processing mode, with partially resolved promises", async () => {
    const { completers, promises } = generateTestPromises(3);
    // Any doesn't return on first reject
    completers[0].reject("bla");

    const testResultPromise = testCombinatorInProcessingMode(
      Promise.any.bind(Promise),
      promises
    );

    completers[2].resolve("my value");

    const { order, result } = await testResultPromise;
    expect(result).toStrictEqual("my value");
    expect(order).toStrictEqual(createOrder(0, 2));
  });

  it("should provide order in processing mode, with all promises already resolved", async () => {
    const { completers, promises } = generateTestPromises(3);
    // Any doesn't return on first reject
    completers[0].reject("bla");
    completers[2].resolve("my value");

    const testResultPromise = testCombinatorInProcessingMode(
      Promise.any.bind(Promise),
      promises
    );

    const { order, result } = await testResultPromise;
    expect(result).toStrictEqual("my value");
    expect(order).toStrictEqual(createOrder(0, 2));
  });

  it("should replay correctly", async () => {
    const { completers, promises } = generateTestPromises(3);
    // This should not influence the result
    completers[1].resolve("another value");
    completers[2].resolve("my value");
    completers[0].reject("bla");

    const result = await testCombinatorInReplayMode(
      Promise.any.bind(Promise),
      promises,
      createOrder(0, 2)
    );

    expect(result).toStrictEqual("my value");
  });
});

describe("PromiseCombinatorTracker with Promise.all", () => {
  it("should provide order in processing mode, with failing child", async () => {
    const { completers, promises } = generateTestPromises(3);

    const testResultPromise = testCombinatorInProcessingMode(
      Promise.all.bind(Promise),
      promises
    );

    completers[2].resolve("my value");
    completers[0].reject("my error");

    const { order, result } = await testResultPromise;
    expect(result).toStrictEqual("my error");
    expect(order).toStrictEqual(createOrder(2, 0));
  });

  it("should provide order in processing mode, with all success children", async () => {
    const { completers, promises } = generateTestPromises(3);

    const testResultPromise = testCombinatorInProcessingMode(
      Promise.all.bind(Promise),
      promises
    );

    completers[2].resolve("my value 2");
    completers[0].resolve("my value 0");
    completers[1].resolve("my value 1");

    const { order, result } = await testResultPromise;
    expect(result).toStrictEqual(["my value 0", "my value 1", "my value 2"]);
    expect(order).toStrictEqual(createOrder(2, 0, 1));
  });

  it("should replay correctly with failing child", async () => {
    const { completers, promises } = generateTestPromises(3);
    // This should not influence the result
    completers[1].resolve("should be irrelevant");
    completers[2].resolve("my value");
    completers[0].reject("my error");

    const result = await testCombinatorInReplayMode(
      Promise.all.bind(Promise),
      promises,
      createOrder(2, 0)
    );

    expect(result).toStrictEqual("my error");
  });

  it("should replay correctly with all success children", async () => {
    const { completers, promises } = generateTestPromises(3);
    completers[2].resolve("my value 2");
    completers[0].resolve("my value 0");
    completers[1].resolve("my value 1");

    const result = await testCombinatorInReplayMode(
      Promise.all.bind(Promise),
      promises,
      createOrder(2, 0, 1)
    );

    expect(result).toStrictEqual(["my value 0", "my value 1", "my value 2"]);
  });
});

// -- Some utility methods for these tests

function generateTestPromises(n: number): {
  completers: Array<CompletablePromise<any>>;
  promises: Array<{ id: PromiseId; promise: Promise<any> }>;
} {
  const completers = [];
  const promises = [];

  for (let i = 0; i < n; i++) {
    const completablePromise = new CompletablePromise<any>();
    completers.push(completablePromise);
    promises.push({
      id: newJournalEntryPromiseId(i),
      promise: completablePromise.promise,
    });
  }

  return { completers, promises };
}

function createOrder(...numbers: number[]) {
  return numbers.map(newJournalEntryPromiseId);
}

async function testCombinatorInProcessingMode(
  combinatorConstructor: (promises: PromiseLike<any>[]) => Promise<any>,
  promises: Array<{ id: PromiseId; promise: Promise<any> }>
) {
  const resultMap = new Map<number, PromiseId[]>();
  const tracker = new PromiseCombinatorTracker(
    () => {
      throw new Error("Unexpected call");
    },
    (combinatorIndex, order) => resultMap.set(combinatorIndex, order)
  );

  return tracker
    .createCombinatorInProcessingMode(combinatorConstructor, promises)
    .then(
      (result) => ({
        order: resultMap.get(0),
        result,
      }),
      (result) => ({
        order: resultMap.get(0),
        result,
      })
    );
}

async function testCombinatorInReplayMode(
  combinatorConstructor: (promises: PromiseLike<any>[]) => Promise<any>,
  promises: Array<{ id: PromiseId; promise: Promise<any> }>,
  order: PromiseId[]
) {
  const tracker = new PromiseCombinatorTracker(
    (idx) => {
      expect(idx).toStrictEqual(0);
      return order;
    },
    () => {
      throw new Error("Unexpected call");
    }
  );

  return (
    tracker
      .createCombinatorInReplayMode(combinatorConstructor, promises)
      // To make sure it behaves like testCombinatorInProcessingMode and always succeeds
      .transform(
        (v) => v,
        (e) => e
      )
  );
}
