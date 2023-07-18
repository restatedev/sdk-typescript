/* eslint-disable @typescript-eslint/no-unused-vars */
"use strict";

import { describe, expect } from "@jest/globals";
import { TestingContext } from "./test_context";
import * as RestateUtils from "../src/utils/public_utils";
import { RestateError, TerminalError } from "../src/types/errors";
import { RestateContext } from "../src/restate_context";
import {
  TestGreeter,
  TestRequest,
  TestResponse,
} from "../src/generated/proto/test";
import * as restate from "../src/public_api";
import { TestDriver } from "./testdriver";
import {
  checkError,
  checkTerminalError,
  completionMessage,
  decodeSideEffectFromResult,
  greetRequest,
  greetResponse,
  inputMessage,
  outputMessage,
  printResults,
  startMessage,
} from "./protoutils";
import { rlog } from "../src/utils/logger";
import {
  SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
  SLEEP_ENTRY_MESSAGE_TYPE,
} from "../src/types/protocol";
import { Message } from "../src/types/types";
import { RetrySettings } from "../src/utils/public_utils";

/**
 * Tests for the method {@linkcode restate_utils.retrySideEffectWithBackoff}.
 */
describe("retrySideEffect()", () => {
  it("should return immediately upon success", async () => {
    await testReturnImmediatelyUponSuccess(RestateUtils.retrySideEffect, true);
  });

  it("should retry until success", async () => {
    await testRetryUntilSuccess(RestateUtils.retrySideEffect, async (x) => x);
  });

  it("should retry until the maximum attemps", async () => {
    await testRetryMaxAttempts(RestateUtils.retrySideEffect);
  });

  it("should initially sleep the minimum time", async () => {
    await testInitialSleepTime(RestateUtils.retrySideEffect);
  });

  it("should ultimately sleep the maximum time", async () => {
    await testUltimateSleepTime(RestateUtils.retrySideEffect);
  });
});

// --------------------------------------------------------
//  shared test implementations
// --------------------------------------------------------

async function testReturnImmediatelyUponSuccess<E, R>(
  method: (
    ctx: RestateContext,
    retrySettings: RetrySettings,
    sideEffect: () => Promise<E>
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

  const result = await method(
    ctx,
    {
      initialDelayMs: 10,
      maxDelayMs: 100,
      maxRetries: 1000000,
      name: "test action",
    } as RetrySettings,
    action
  );

  expect(invocations).toStrictEqual(1);
  expect(timesSleepCalled).toStrictEqual(0);

  return result;
}

async function testRetryUntilSuccess<E, R>(
  method: (
    ctx: RestateContext,
    retrySettings: RetrySettings,
    sideEffect: () => Promise<E>
  ) => Promise<R>,
  resultProducer: (result: boolean) => Promise<E>
): Promise<R> {
  const ctx = TestingContext.create();

  let remainingFailures = 3;
  const action: () => Promise<E> = () =>
    resultProducer(--remainingFailures === 0);

  const result = await method(
    ctx,
    {
      initialDelayMs: 10,
      maxDelayMs: 100,
      maxRetries: 1000000,
      name: "test action",
    } as RetrySettings,
    action
  );

  expect(remainingFailures).toStrictEqual(0);

  return result;
}

async function testRetryMaxAttempts<R>(
  method: (
    ctx: RestateContext,
    retrySettings: RetrySettings,
    sideEffect: () => Promise<boolean>
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
    const result = await method(
      ctx,
      {
        initialDelayMs: 10,
        maxDelayMs: 100,
        maxRetries: numRetries,
        name: "test action",
      } as RetrySettings,
      wrappedAction
    );

    fail("expected an exception to be thrown");
  } catch (e) {
    expect(e).toBeInstanceOf(RestateError);
  }

  expect(numInvocationsHappened).toStrictEqual(numRetries + 1);
}

async function testInitialSleepTime<R>(
  method: (
    ctx: RestateContext,
    retrySettings: RetrySettings,
    sideEffect: () => Promise<boolean>
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
  await method(
    ctx,
    {
      initialDelayMs: 10,
      maxDelayMs: 100,
      maxRetries: 100000,
      name: "test action",
    } as RetrySettings,
    wrappedAction
  );

  expect(initSleep).toStrictEqual(10);
}

async function testUltimateSleepTime<R>(
  method: (
    ctx: RestateContext,
    retrySettings: RetrySettings,
    sideEffect: () => Promise<boolean>
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
  await method(
    ctx,
    {
      initialDelayMs: 10,
      maxDelayMs: 100,
      maxRetries: 100000,
      name: "test action",
    } as RetrySettings,
    wrappedAction
  );

  expect(lastSleepTime).toStrictEqual(100);
}

class FailingExceptionalSideEffectGreeter implements TestGreeter {
  constructor(
    readonly fn: () => Promise<boolean>
  ) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    // state
    const success = await ctx.sideEffect(
      this.fn,
      {
        initialDelayMs: 100,
        maxDelayMs: 500,
        maxRetries: 3,
      } as RetrySettings
    );

    return TestResponse.create({ greeting: `${success}` });
  }
}

class FailingRetrySideEffectGreeter implements TestGreeter {
  constructor(readonly attempts: number) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    // state
    const doCall = async () => callReturningFalse(this.attempts);
    await RestateUtils.retrySideEffect(
      ctx,
      {
        initialDelayMs: 100,
        maxDelayMs: 500,
        maxRetries: 3,
      },
      doCall
    );

    return TestResponse.create({ greeting: `Passed` });
  }
}

let i = 0;

async function callReturningFalse(attempts: number): Promise<boolean> {
  if (i >= attempts) {
    rlog.debug("Call succeeded");
    return true;
  } else {
    rlog.debug("Call failed");
    i = i + 1;
    return false;
  }
}

async function failingCall(attempts: number): Promise<boolean> {
  if (i >= attempts) {
    rlog.debug("Call succeeded");
    i = 0;
    return true;
  } else {
    rlog.debug("Call failed");
    i = i + 1;
    throw new Error("Call failed");
  }
}

async function terminalFailingCall(attempts: number): Promise<boolean> {
  if (i >= attempts) {
    rlog.debug("Call succeeded");
    i = 0;
    return true;
  } else {
    rlog.debug("Call failed");
    i = i + 1;
    throw new TerminalError("Call failed");
  }
}

describe("FailingExceptionalSideEffectGreeter", () => {
  it("fails immediately with terminal error", async () => {
    i = 0;
    const result = await new TestDriver(
      new FailingExceptionalSideEffectGreeter(async () => terminalFailingCall(2)),
      [
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(1), // fail
      ]
    ).run();

    printResults(result)
    expect(result.length).toStrictEqual(2);
    checkIfSideEffectReturnsCallFailed(result[0]);
    checkTerminalError(result[1], "Uncaught exception for invocation id: Call failed")
  });

  it("retries two times and then succeeds for retryable errors", async () => {
    i = 0;
    const result = await new TestDriver(
      new FailingExceptionalSideEffectGreeter(async () => failingCall(2)),
      [
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(1), // fail
        completionMessage(2, undefined, true), // sleep
        completionMessage(3), // fail
        completionMessage(4, undefined, true), // sleep
        completionMessage(5), // success
      ]
    ).run();

    expect(result.length).toStrictEqual(6);
    checkIfSideEffectReturnsCallFailed(result[0]);
    expect(result[1].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    checkIfSideEffectReturnsCallFailed(result[2]);
    expect(result[3].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result[4].messageType).toStrictEqual(SIDE_EFFECT_ENTRY_MESSAGE_TYPE);
    expect(decodeSideEffectFromResult(result[4].message).value).toStrictEqual(
      Buffer.from(JSON.stringify(true))
    );
    expect(result[5]).toStrictEqual(outputMessage(greetResponse("true")));
  });

  it("retries three times and then fails for retryable errors", async () => {
    i = 0;
    const result = await new TestDriver(
      new FailingExceptionalSideEffectGreeter(async () => failingCall(4)),
      [
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(1), // fail
        completionMessage(2, undefined, true), // sleep
        completionMessage(3), // fail
        completionMessage(4, undefined, true), // sleep
        completionMessage(5), // fail
        completionMessage(6, undefined, true), // sleep
        completionMessage(7), // fail
      ]
    ).run();

    expect(result.length).toStrictEqual(8);
    checkIfSideEffectReturnsCallFailed(result[0]);
    expect(result[1].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    checkIfSideEffectReturnsCallFailed(result[2]);
    expect(result[3].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    checkIfSideEffectReturnsCallFailed(result[4]);
    expect(result[5].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    checkIfSideEffectReturnsCallFailed(result[6]);
    checkError(result[7], "Retries exhausted for ");
  });
});

describe("FailingRetrySideEffectGreeter", () => {
  it("retries two times and then succeeds", async () => {
    i = 0;
    const result = await new TestDriver(new FailingRetrySideEffectGreeter(2), [
      startMessage(1),
      inputMessage(greetRequest("Till")),
      completionMessage(1), // fail
      completionMessage(2, undefined, true), // sleep
      completionMessage(3), // fail
      completionMessage(4, undefined, true), // sleep
      completionMessage(5), // success
    ]).run();

    expect(result.length).toStrictEqual(6);
    checkIfSideEffectReturnsFalse(result[0]);
    expect(result[1].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    checkIfSideEffectReturnsFalse(result[2]);
    expect(result[3].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result[4].messageType).toStrictEqual(SIDE_EFFECT_ENTRY_MESSAGE_TYPE);
    expect(
      decodeSideEffectFromResult(result[4].message).value?.toString()
    ).toStrictEqual("true");
    expect(result[5]).toStrictEqual(outputMessage(greetResponse("Passed")));
  });

  it("retries three times and then fails", async () => {
    i = 0;
    const result = await new TestDriver(new FailingRetrySideEffectGreeter(4), [
      startMessage(1),
      inputMessage(greetRequest("Till")),
      completionMessage(1), // fail
      completionMessage(2, undefined, true), // sleep
      completionMessage(3), // fail
      completionMessage(4, undefined, true), // sleep
      completionMessage(5), // fail
      completionMessage(6, undefined, true), // sleep
      completionMessage(7), // fail
    ]).run();

    expect(result.length).toStrictEqual(8);
    checkIfSideEffectReturnsFalse(result[0]);
    expect(result[1].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    checkIfSideEffectReturnsFalse(result[2]);
    expect(result[3].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    checkIfSideEffectReturnsFalse(result[4]);
    expect(result[5].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    checkIfSideEffectReturnsFalse(result[6]);
    checkError(result[7], "Retries exhausted for ");
  });
});

function checkIfSideEffectReturnsFalse(msg: Message) {
  expect(msg.messageType).toStrictEqual(SIDE_EFFECT_ENTRY_MESSAGE_TYPE);
  expect(
    decodeSideEffectFromResult(msg.message).value?.toString()
  ).toStrictEqual("false");
}

function checkIfSideEffectReturnsCallFailed(msg: Message) {
  expect(msg.messageType).toStrictEqual(SIDE_EFFECT_ENTRY_MESSAGE_TYPE);
  expect(
    decodeSideEffectFromResult(msg.message).failure?.message
  ).toContain("Call failed");
}
