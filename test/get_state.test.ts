"use strict";

import { describe, expect } from "@jest/globals";
import * as restate from "../src/public_api";
import { TestDriver } from "./testdriver";
import {
  completionMessage,
  getStateMessage,
  greetRequest,
  greetResponse,
  inputMessage,
  outputMessage,
  startMessage,
  suspensionMessage,
} from "./protoutils";
import {
  protoMetadata,
  TestGreeter,
  TestRequest,
  TestResponse,
} from "../src/generated/proto/test";
import { ProtocolMode } from "../src/generated/proto/discovery";

class GetStateGreeter implements TestGreeter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    // state
    let state = await ctx.get<string>("STATE");
    if (state === null) {
      state = "nobody";
    }

    return TestResponse.create({ greeting: `Hello ${state}` });
  }
}

class NumberGetStateGreeter implements TestGreeter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    // state
    const state = (await ctx.get<number>("STATE")) || 0;

    return TestResponse.create({ greeting: `Hello ${state}` });
  }
}

class NumberListGetStateGreeter implements TestGreeter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
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

describe("GetStateGreeter: With GetStateEntry already complete", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new GetStateGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(2),
        inputMessage(greetRequest("Till")),
        getStateMessage("STATE", "Francesco"),
      ]
    ).run();

    expect(result).toStrictEqual([
      outputMessage(greetResponse("Hello Francesco")),
    ]);
  });
});

describe("GetStateGreeter: With GetStateEntry bidi stream sends suspension", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new GetStateGreeter(),
      "/test.TestGreeter/Greet",
      [startMessage(1), inputMessage(greetRequest("Till"))]
    ).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      suspensionMessage([1]),
    ]);
  });
});

describe("GetStateGreeter: Request-response GetStateEntry", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new GetStateGreeter(),
      "/test.TestGreeter/Greet",
      [startMessage(1), inputMessage(greetRequest("Till"))],
      ProtocolMode.REQUEST_RESPONSE
    ).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      suspensionMessage([1]),
    ]);
  });
});

describe("GetStateGreeter: Without GetStateEntry and completed with later CompletionFrame", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new GetStateGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(1, JSON.stringify("Francesco")),
      ]
    ).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      outputMessage(greetResponse("Hello Francesco")),
    ]);
  });
});

describe("GetStateGreeter: Without GetStateEntry and completed with later CompletionFrame with Empty state", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new GetStateGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(1, undefined, true),
      ]
    ).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      outputMessage(greetResponse("Hello nobody")),
    ]);
  });
});

describe("GetStateGreeter: Without GetStateEntry and completed with later CompletionFrame with Empty state replayed", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new GetStateGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(2),
        inputMessage(greetRequest("Till")),
        getStateMessage("STATE", undefined, true),
      ]
    ).run();

    expect(result).toStrictEqual([
      outputMessage(greetResponse("Hello nobody")),
    ]);
  });
});

describe("GetStateGreeter: Without GetStateEntry and completed with later CompletionFrame with empty string", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new GetStateGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(1, Buffer.from(JSON.stringify(""))),
      ]
    ).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      outputMessage(greetResponse("Hello ")),
    ]);
  });
});

describe("NumberGetStateGreeter: Without GetStateEntry and completed with later CompletionFrame with numeric value 70", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new NumberGetStateGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(1, Buffer.from(JSON.stringify(70))),
      ]
    ).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      outputMessage(greetResponse("Hello 70")),
    ]);
  });
});

describe("NumberGetStateGreeter: Without GetStateEntry and completed with later CompletionFrame with value 0", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new NumberGetStateGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(1, Buffer.from(JSON.stringify(0))),
      ]
    ).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      outputMessage(greetResponse("Hello 0")),
    ]);
  });
});

describe("NumberListGetStateGreeter: Without GetStateEntry and completed with later CompletionFrame with list state", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new NumberListGetStateGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(1, Buffer.from(JSON.stringify([5, 4]))),
      ]
    ).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      outputMessage(greetResponse("Hello index 0: 5 - index 1: 4")),
    ]);
  });
});

describe("NumberListGetStateGreeter: Without GetStateEntry and completed with later CompletionFrame with empty list state", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new NumberListGetStateGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(1, Buffer.from(JSON.stringify([]))),
      ]
    ).run();

    // For an empty list it will print undefined values for the first two indices
    // but still recognize it as a list
    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      outputMessage(
        greetResponse("Hello index 0: undefined - index 1: undefined")
      ),
    ]);
  });
});
