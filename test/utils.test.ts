/* eslint-disable @typescript-eslint/no-unused-vars */
"use strict";

import { describe, expect } from "@jest/globals";
import {
  TestGreeter,
  TestRequest,
  TestResponse,
} from "../src/generated/proto/test";
import * as restate from "../src/public_api";
import { TestDriver } from "./testdriver";
import {
  checkError,
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
import { jsonDeserialize, jsonSerialize, printMessageAsJson } from "../src/utils/utils";
import { RestateContext } from "../src/public_api";
import { TestingContext } from "./test_context";
import { RestateError } from "../src/types/errors";
import * as RestateUtils from "../src/utils/public_utils"

describe("JSON de-/serialization", () => {
  it("should be able to handle bigint", () => {
    const myType = {
      a: "Hello!",
      b: 42n,
    };

    const json = jsonSerialize(myType);
    const obj = jsonDeserialize(json);

    expect(obj).toStrictEqual(myType);
  });
});

describe("JSON printing", () => {
  it("should be able to handle bigInt", () => {
    const myType = {
      a: "Hello!",
      b: 42n,
    };

    printMessageAsJson(myType);
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

class FailingExceptionalSideEffectGreeter implements TestGreeter {
  constructor(readonly attempts: number) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    // state
    const doCall = async () => failingCall(this.attempts);
    const success = await RestateUtils.retryExceptionalSideEffectWithBackoff(
      ctx,
      doCall,
      100,
      500,
      3
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
    await RestateUtils.retrySideEffectWithBackoff(ctx, doCall, 100, 500, 3);

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

describe("FailingSideEffectGreeter: finally succeeds", () => {
  it("retries two times and then succeeds", async () => {
    i = 0;
    const result = await new TestDriver(
      new FailingExceptionalSideEffectGreeter(2),
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
});

describe("FailingSideEffectGreeter: never succeeds", () => {
  it("retries three times and then fails", async () => {
    i = 0;
    const result = await new TestDriver(
      new FailingExceptionalSideEffectGreeter(4),
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

describe("FailingRetrySideEffectGreeter: finally succeeds", () => {
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
});

describe("FailingRetrySideEffectGreeter: never succeeds", () => {
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

    printResults(result);

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
  ).toStrictEqual("Call failed");
}
