/* eslint-disable @typescript-eslint/no-unused-vars */
"use strict";

import { describe, expect } from "@jest/globals";
import { TestingContext } from "./test_context";
import * as RestateUtils from "../src/utils/utils";
import { RestateError } from "../src/types/errors";
import { RestateContext } from "../src/restate_context";

async function exceptionOnFalse(x: Promise<boolean>): Promise<boolean> {
  return (await x) ? x : Promise.reject(new Error("test error"));
}

/**
 * Tests for the method {@linkcode restate_utils.retrySideEffectWithBackoff}.
 */
describe("retrySideEffectWithBackoff()", () => {
  it("should return immediately upon success", async () => {
    await testReturnImmediatelyUponSuccess(
      RestateUtils.retrySideEffectWithBackoff,
      true
    );
  });

  it("should retry until success", async () => {
    await testRetryUntilSuccess(
      RestateUtils.retrySideEffectWithBackoff,
      async (x) => x
    );
  });

  it("should retry until the maximum attemps", async () => {
    await testRetryMaxAttempts(RestateUtils.retrySideEffectWithBackoff);
  });

  it("should initially sleep the minimum time", async () => {
    await testInitialSleepTime(RestateUtils.retrySideEffectWithBackoff);
  });

  it("should ultimately sleep the maximum time", async () => {
    await testUltimateSleepTime(RestateUtils.retrySideEffectWithBackoff);
  });
});

/**
 * Tests for the method {@linkcode restate_utils.retryExceptionalSideEffectWithBackoff}.
 */
describe("retryExceptionalSideEffectWithBackoff()", () => {
  it("should return immediately upon success", async () => {
    const result = await testReturnImmediatelyUponSuccess(
      RestateUtils.retryExceptionalSideEffectWithBackoff,
      "great!"
    );

    expect(result).toStrictEqual("great!");
  });

  it("should retry until success", async () => {
    const finalValue = "success!!!";
    const resultProducer = async (val: boolean) =>
      val ? finalValue : Promise.reject(new Error("..."));

    const result = await testRetryUntilSuccess(
      RestateUtils.retryExceptionalSideEffectWithBackoff,
      resultProducer
    );

    expect(result).toStrictEqual(finalValue);
  });

  it("should retry until the maximum attemps", async () => {
    await testRetryMaxAttempts(
      RestateUtils.retryExceptionalSideEffectWithBackoff<boolean>,
      exceptionOnFalse
    );
  });

  it("should initially sleep the minimum time", async () => {
    await testInitialSleepTime(
      RestateUtils.retryExceptionalSideEffectWithBackoff<boolean>,
      exceptionOnFalse
    );
  });

  it("should ultimately sleep the maximum time", async () => {
    await testUltimateSleepTime(
      RestateUtils.retryExceptionalSideEffectWithBackoff<boolean>,
      exceptionOnFalse
    );
  });
});

// --------------------------------------------------------
//  shared test implementations
// --------------------------------------------------------

async function testReturnImmediatelyUponSuccess<E, R>(
  method: (
    ctx: RestateContext,
    action: () => Promise<E>,
    minSleep: number,
    maxSleep: number,
    numRetries: number,
    name: string
  ) => Promise<R>,
  actionResult: E
): Promise<R> {
  const ctx = TestingContext.create();
  let timesSleepCalled = 0;
  ctx.sleep = (millis: number) => {
    timesSleepCalled++;
    return Promise.resolve();
  };

  let invocations = 0;
  const action: () => Promise<E> = async () => {
    invocations++;
    return actionResult;
  };

  const result = await method(ctx, action, 10, 100, 1000000, "test action");

  expect(invocations).toStrictEqual(1);
  expect(timesSleepCalled).toStrictEqual(0);

  return result;
}

async function testRetryUntilSuccess<E, R>(
  method: (
    ctx: RestateContext,
    action: () => Promise<E>,
    minSleep: number,
    maxSleep: number,
    numRetries: number,
    name: string
  ) => Promise<R>,
  resultProducer: (result: boolean) => Promise<E>
): Promise<R> {
  const ctx = TestingContext.create();

  let remainingFailures = 3;
  const action: () => Promise<E> = () =>
    resultProducer(--remainingFailures === 0);

  const result = await method(ctx, action, 10, 100, 1000000, "test action");

  expect(remainingFailures).toStrictEqual(0);

  return result;
}

async function testRetryMaxAttempts<R>(
  method: (
    ctx: RestateContext,
    action: () => Promise<boolean>,
    minSleep: number,
    maxSleep: number,
    numRetries: number,
    name: string
  ) => Promise<R>,
  sideEffectWrapper: (result: Promise<boolean>) => Promise<boolean> = (x) => x
) {
  const ctx = TestingContext.create();
  const numRetries = 2;

  let numInvocationsHappened = 0;
  const action: () => Promise<boolean> = () => {
    numInvocationsHappened++;
    return Promise.resolve(false);
  };
  const wrappedAction = () => sideEffectWrapper(action());

  try {
    await method(ctx, wrappedAction, 10, 100, numRetries, "test action");

    fail("expected an exception to be thrown");
  } catch (e) {
    expect(e).toBeInstanceOf(RestateError);
  }

  expect(numInvocationsHappened).toStrictEqual(numRetries + 1);
}

async function testInitialSleepTime<R>(
  method: (
    ctx: RestateContext,
    action: () => Promise<boolean>,
    minSleep: number,
    maxSleep: number,
    numRetries: number,
    name: string
  ) => Promise<R>,
  sideEffectWrapper: (result: Promise<boolean>) => Promise<boolean> = (x) => x
) {
  let initSleep = -1;

  const ctx = TestingContext.create();
  ctx.sleep = (millis: number) => {
    initSleep = initSleep == -1 ? millis : initSleep;
    return Promise.resolve();
  };

  let callsLeft = 20;
  const action: () => Promise<boolean> = () =>
    Promise.resolve(--callsLeft <= 0);

  const wrappedAction = () => sideEffectWrapper(action());
  await method(ctx, wrappedAction, 10, 100, 100000, "test action");

  expect(initSleep).toStrictEqual(10);
}

async function testUltimateSleepTime<R>(
  method: (
    ctx: RestateContext,
    action: () => Promise<boolean>,
    minSleep: number,
    maxSleep: number,
    numRetries: number,
    name: string
  ) => Promise<R>,
  sideEffectWrapper: (result: Promise<boolean>) => Promise<boolean> = (x) => x
) {
  let lastSleepTime = 0;

  const ctx = TestingContext.create();
  ctx.sleep = (millis: number) => {
    lastSleepTime = millis;
    return Promise.resolve();
  };

  let callsLeft = 20;
  const action: () => Promise<boolean> = () =>
    Promise.resolve(--callsLeft <= 0);

  const wrappedAction = () => sideEffectWrapper(action());
  await method(ctx, wrappedAction, 10, 100, 100000, "test action");

  expect(lastSleepTime).toStrictEqual(100);
}
