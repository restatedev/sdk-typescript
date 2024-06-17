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

import { describe, expect } from "@jest/globals";
import type * as restate from "../src/public_api";

import type { TestGreeter, TestRequest } from "./testdriver";
import { TestDriver, TestResponse } from "./testdriver";
import {
  checkJournalMismatchError,
  clearStateMessage,
  completionMessage,
  END_MESSAGE,
  getStateMessage,
  greetRequest,
  greetResponse,
  inputMessage,
  outputMessage,
  setStateMessage,
  startMessage,
  suspensionMessage,
} from "./protoutils";
import { ProtocolMode } from "../src/types/discovery";

class GetAndSetGreeter implements TestGreeter {
  async greet(
    ctx: restate.ObjectContext,
    request: TestRequest
  ): Promise<TestResponse> {
    // state
    const state = (await ctx.get<string>("STATE")) || "nobody";

    ctx.set("STATE", request.name);

    return TestResponse.create({ greeting: `Hello ${state}` });
  }
}

describe("GetAndSetGreeter", () => {
  it("sends get and set state message to the runtime", async () => {
    const result = await new TestDriver(new GetAndSetGreeter(), [
      startMessage({ key: "Till" }),
      inputMessage(greetRequest("Till")),
      completionMessage(1, JSON.stringify("Pete")),
    ]).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      setStateMessage("STATE", "Till"),
      outputMessage(greetResponse("Hello Pete")),
      END_MESSAGE,
    ]);
  });

  it("send message to runtime for request-response mode", async () => {
    const result = await new TestDriver(
      new GetAndSetGreeter(),
      [startMessage(), inputMessage(greetRequest("Till"))],
      ProtocolMode.REQUEST_RESPONSE
    ).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      suspensionMessage([1]),
    ]);
  });

  it("handles replay with value", async () => {
    const result = await new TestDriver(new GetAndSetGreeter(), [
      startMessage({ key: "Till" }),
      inputMessage(greetRequest("Till")),
      getStateMessage("STATE", "Francesco"),
      setStateMessage("STATE", "Till"),
    ]).run();

    expect(result).toStrictEqual([
      outputMessage(greetResponse("Hello Francesco")),
      END_MESSAGE,
    ]);
  });

  it("fails on journal mismatch. GetState completed with setState.", async () => {
    const result = await new TestDriver(new GetAndSetGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      setStateMessage("STATE", "Francesco"), // should have been getStateMessage
      setStateMessage("STATE", "Till"),
    ]).run();

    expect(result.length).toStrictEqual(1);
    checkJournalMismatchError(result[0]);
  });

  it("fails on journal mismatch. SetState completed with getState.", async () => {
    const result = await new TestDriver(new GetAndSetGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      getStateMessage("STATE", "Francesco"),
      getStateMessage("STATE", "Till"), // should have been setStateMessage
    ]).run();

    expect(result.length).toStrictEqual(1);
    checkJournalMismatchError(result[0]);
  });

  it("fails on journal mismatch. SetState completed with clearState.", async () => {
    const result = await new TestDriver(new GetAndSetGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      getStateMessage("STATE", "Francesco"),
      clearStateMessage("STATE"), // should have been setStateMessage
    ]).run();

    expect(result.length).toStrictEqual(1);
    checkJournalMismatchError(result[0]);
  });

  it("fails on journal mismatch. SetState completed with different key.", async () => {
    const result = await new TestDriver(new GetAndSetGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      getStateMessage("STATE", "Francesco"),
      setStateMessage("STATEE", "Till"), // should have been STATE
    ]).run();

    expect(result.length).toStrictEqual(1);
    checkJournalMismatchError(result[0]);
  });

  it("fails on journal mismatch. SetState completed with different value.", async () => {
    const result = await new TestDriver(new GetAndSetGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      getStateMessage("STATE", "Francesco"),
      setStateMessage("STATE", "AnotherName"), // should have been Francesco
    ]).run();

    expect(result.length).toStrictEqual(1);
    checkJournalMismatchError(result[0]);
  });

  it("fails on journal mismatch. GetState completed with different key.", async () => {
    const result = await new TestDriver(new GetAndSetGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      getStateMessage("STATEE"), // should have been STATE
    ]).run();

    expect(result.length).toStrictEqual(1);
    checkJournalMismatchError(result[0]);
  });
});

class ClearStateGreeter implements TestGreeter {
  async greet(
    ctx: restate.ObjectContext,
    request: TestRequest
  ): Promise<TestResponse> {
    // state
    const state = (await ctx.get<string>("STATE")) || "nobody";

    ctx.set("STATE", request.name);

    ctx.clear("STATE");

    return TestResponse.create({ greeting: `Hello ${state}` });
  }
}
describe("ClearState", () => {
  it("sends message to runtime", async () => {
    const result = await new TestDriver(new ClearStateGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      completionMessage(1, JSON.stringify("Francesco")),
    ]).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      setStateMessage("STATE", "Till"),
      clearStateMessage("STATE"),
      outputMessage(greetResponse("Hello Francesco")),
      END_MESSAGE,
    ]);
  });

  it("handles replay", async () => {
    const result = await new TestDriver(new ClearStateGreeter(), [
      startMessage({}),
      inputMessage(greetRequest("Till")),
      getStateMessage("STATE", "Francesco"),
      setStateMessage("STATE", "Till"),
      clearStateMessage("STATE"),
    ]).run();

    expect(result).toStrictEqual([
      outputMessage(greetResponse("Hello Francesco")),
      END_MESSAGE,
    ]);
  });

  it("fails on journal mismatch. ClearState completed with getState.", async () => {
    const result = await new TestDriver(new ClearStateGreeter(), [
      startMessage({}),
      inputMessage(greetRequest("Till")),
      getStateMessage("STATE", "Francesco"),
      setStateMessage("STATE", "Till"),
      getStateMessage("STATE"), // this should have been a clearStateMessage
    ]).run();

    expect(result.length).toStrictEqual(1);
    checkJournalMismatchError(result[0]);
  });

  it("fails on journal mismatch. ClearState completed with setState.", async () => {
    const result = await new TestDriver(new ClearStateGreeter(), [
      startMessage({}),
      inputMessage(greetRequest("Till")),
      getStateMessage("STATE", "Francesco"),
      setStateMessage("STATE", "Till"),
      setStateMessage("STATE", "Till"), // this should have been a clearStateMessage
    ]).run();

    expect(result.length).toStrictEqual(1);
    checkJournalMismatchError(result[0]);
  });

  it("fails on journal mismatch. ClearState completed with different key.", async () => {
    const result = await new TestDriver(new ClearStateGreeter(), [
      startMessage({}),
      inputMessage(greetRequest("Till")),
      getStateMessage("STATE", "Francesco"),
      setStateMessage("STATE", "Till"),
      clearStateMessage("STATEE"), // this should have been STATE
    ]).run();

    expect(result.length).toStrictEqual(1);
    checkJournalMismatchError(result[0]);
  });
});

enum OrderStatus {
  ORDERED,
  DELIVERED,
}

class GetAndSetEnumGreeter implements TestGreeter {
  async greet(ctx: restate.ObjectContext): Promise<TestResponse> {
    // state
    const oldState = await ctx.get<OrderStatus>("STATE");

    ctx.set("STATE", OrderStatus.ORDERED);

    const newState = await ctx.get<OrderStatus>("STATE");

    return TestResponse.create({ greeting: `Hello ${oldState} - ${newState}` });
  }
}

describe("GetAndSetEnumGreeter", () => {
  it("handles replays with value.", async () => {
    const result = await new TestDriver(new GetAndSetEnumGreeter(), [
      startMessage({}),
      inputMessage(greetRequest("Till")),
      getStateMessage("STATE", OrderStatus.DELIVERED),
      setStateMessage("STATE", OrderStatus.ORDERED),
      getStateMessage("STATE", OrderStatus.ORDERED),
    ]).run();

    expect(result).toStrictEqual([
      outputMessage(greetResponse("Hello 1 - 0")),
      END_MESSAGE,
    ]);
  });

  it("handles replays with value. First empty state, then enum state.", async () => {
    const result = await new TestDriver(new GetAndSetEnumGreeter(), [
      startMessage({}),
      inputMessage(greetRequest("Till")),
      getStateMessage("STATE", undefined, true),
      setStateMessage("STATE", OrderStatus.ORDERED),
      getStateMessage("STATE", OrderStatus.ORDERED),
    ]).run();

    expect(result).toStrictEqual([
      outputMessage(greetResponse("Hello null - 0")),
      END_MESSAGE,
    ]);
  });
});
