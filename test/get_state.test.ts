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
import * as restate from "../src/public_api";
import { TestDriver } from "./testdriver";
import {
  checkJournalMismatchError,
  completionMessage,
  getStateMessage,
  greetRequest,
  greetResponse,
  inputMessage,
  outputMessage,
  setStateMessage,
  startMessage,
  suspensionMessage,
} from "./protoutils";
import { TestGreeter, TestResponse } from "../src/generated/proto/test";
import { ProtocolMode } from "../src/generated/proto/discovery";

class GetStringStateGreeter implements TestGreeter {
  async greet(): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    // state
    let state = await ctx.get<string>("STATE");
    if (state === null) {
      state = "nobody";
    }

    return TestResponse.create({ greeting: `Hello ${state}` });
  }
}

describe("GetStringStateGreeter", () => {
  it("sends message to runtime", async () => {
    const result = await new TestDriver(new GetStringStateGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
    ]).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      suspensionMessage([1]),
    ]);
  });

  it("sends message to runtime for request-response mode", async () => {
    const result = await new TestDriver(
      new GetStringStateGreeter(),
      [startMessage(1), inputMessage(greetRequest("Till"))],
      ProtocolMode.REQUEST_RESPONSE
    ).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      suspensionMessage([1]),
    ]);
  });

  it("handles completion with value", async () => {
    const result = await new TestDriver(new GetStringStateGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      completionMessage(1, JSON.stringify("Francesco")),
    ]).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      outputMessage(greetResponse("Hello Francesco")),
    ]);
  });

  it("handles completion with empty", async () => {
    const result = await new TestDriver(new GetStringStateGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      completionMessage(1, undefined, true),
    ]).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      outputMessage(greetResponse("Hello nobody")),
    ]);
  });

  it("handles completion with empty string", async () => {
    const result = await new TestDriver(new GetStringStateGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      completionMessage(1, Buffer.from(JSON.stringify(""))),
    ]).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      outputMessage(greetResponse("Hello ")),
    ]);
  });

  it("handles replay with value", async () => {
    const result = await new TestDriver(new GetStringStateGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      getStateMessage("STATE", "Francesco"),
    ]).run();

    expect(result).toStrictEqual([
      outputMessage(greetResponse("Hello Francesco")),
    ]);
  });

  it("handles replay with empty", async () => {
    const result = await new TestDriver(new GetStringStateGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      getStateMessage("STATE", undefined, true),
    ]).run();

    expect(result).toStrictEqual([
      outputMessage(greetResponse("Hello nobody")),
    ]);
  });
});

class GetNumberStateGreeter implements TestGreeter {
  async greet(): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    // state
    const state = await ctx.get<number>("STATE");

    return TestResponse.create({ greeting: `Hello ${state}` });
  }
}

describe("GetNumberStateGreeter", () => {
  it("sends message to the runtime", async () => {
    const result = await new TestDriver(new GetNumberStateGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
    ]).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      suspensionMessage([1]),
    ]);
  });

  it("handles completion with value", async () => {
    const result = await new TestDriver(new GetNumberStateGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      completionMessage(1, Buffer.from(JSON.stringify(70))),
    ]).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      outputMessage(greetResponse("Hello 70")),
    ]);
  });

  it("handles completion with value 0", async () => {
    const result = await new TestDriver(new GetNumberStateGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      completionMessage(1, Buffer.from(JSON.stringify(0))),
    ]).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      outputMessage(greetResponse("Hello 0")),
    ]);
  });

  it("handles completion with empty", async () => {
    const result = await new TestDriver(new GetNumberStateGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      completionMessage(1, undefined, true),
    ]).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      outputMessage(greetResponse("Hello null")),
    ]);
  });

  it("handles replay with value", async () => {
    const result = await new TestDriver(new GetNumberStateGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      getStateMessage<number>("STATE", 70),
    ]).run();

    expect(result).toStrictEqual([outputMessage(greetResponse("Hello 70"))]);
  });

  it("handles replay with value 0", async () => {
    const result = await new TestDriver(new GetNumberStateGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      getStateMessage<number>("STATE", 0),
    ]).run();

    expect(result).toStrictEqual([outputMessage(greetResponse("Hello 0"))]);
  });

  it("handles replay with empty", async () => {
    const result = await new TestDriver(new GetNumberStateGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      getStateMessage<number>("STATE", undefined, true),
    ]).run();

    expect(result).toStrictEqual([outputMessage(greetResponse("Hello null"))]);
  });

  it("fails on journal mismatch. Completed with SetStateMessage.", async () => {
    const result = await new TestDriver(new GetNumberStateGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      setStateMessage("STATE", 0),
    ]).run();

    expect(result.length).toStrictEqual(1);
    checkJournalMismatchError(result[0]);
  });
});

class GetNumberListStateGreeter implements TestGreeter {
  async greet(): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    // state
    const state = await ctx.get<number[]>("STATE");
    if (state) {
      return TestResponse.create({
        greeting: `Hello index 0: ${state[0]} - index 1: ${state[1]}`,
      });
    } else {
      return TestResponse.create({ greeting: `Hello no state found` });
    }
  }
}

describe("GetNumberListStateGreeter", () => {
  it("sends message to runtime", async () => {
    const result = await new TestDriver(new GetNumberListStateGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
    ]).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      suspensionMessage([1]),
    ]);
  });

  it("handles completion with value", async () => {
    const result = await new TestDriver(new GetNumberListStateGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      completionMessage(1, Buffer.from(JSON.stringify([5, 4]))),
    ]).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      outputMessage(greetResponse("Hello index 0: 5 - index 1: 4")),
    ]);
  });

  it("handles completion with value empty list", async () => {
    const result = await new TestDriver(new GetNumberListStateGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      completionMessage(1, Buffer.from(JSON.stringify([]))),
    ]).run();

    // For an empty list it will print undefined values for the first two indices
    // but still recognize it as a list
    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      outputMessage(
        greetResponse("Hello index 0: undefined - index 1: undefined")
      ),
    ]);
  });

  it("handles completion with empty", async () => {
    const result = await new TestDriver(new GetNumberListStateGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      completionMessage(1, undefined, true),
    ]).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      outputMessage(greetResponse("Hello no state found")),
    ]);
  });

  it("handles replay with value", async () => {
    const result = await new TestDriver(new GetNumberListStateGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      getStateMessage("STATE", [5, 4]),
    ]).run();

    expect(result).toStrictEqual([
      outputMessage(greetResponse("Hello index 0: 5 - index 1: 4")),
    ]);
  });

  it("handles replay with value empty list", async () => {
    const result = await new TestDriver(new GetNumberListStateGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      getStateMessage("STATE", []),
    ]).run();

    expect(result).toStrictEqual([
      outputMessage(
        greetResponse("Hello index 0: undefined - index 1: undefined")
      ),
    ]);
  });

  it("handles replay with value empty list", async () => {
    const result = await new TestDriver(new GetNumberListStateGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      getStateMessage("STATE", undefined, true),
    ]).run();

    expect(result).toStrictEqual([
      outputMessage(greetResponse("Hello no state found")),
    ]);
  });

  it("fails on journal mismatch. Completed with wrong state key", async () => {
    const result = await new TestDriver(new GetNumberListStateGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      getStateMessage("STATEE", undefined, true),
    ]).run();

    expect(result.length).toStrictEqual(1);
    checkJournalMismatchError(result[0]);
  });
});
