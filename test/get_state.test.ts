import { describe, expect } from "@jest/globals";
import * as restate from "../src/public_api";
import { TestDriver } from "../src/testdriver";
import {
  getStateMessage,
  inputMessage,
  startMessage,
  completionMessage,
  outputMessage,
  greetRequest,
  greetResponse,
} from "./protoutils";
import {
  protoMetadata,
  TestGreeter,
  TestRequest,
  TestResponse,
} from "../src/generated/proto/test";
import { Failure } from "../src/generated/proto/protocol";

class GetStateGreeter implements TestGreeter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    // state
    const state = (await ctx.get<string>("STATE")) || "nobody";
    console.log("Current state is " + state);

    return TestResponse.create({ greeting: `Hello ${state}` });
  }
}

describe("GetStateGreeter: With GetStateEntry already complete", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new GetStateGreeter(),
      "/dev.restate.TestGreeter/Greet",
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

describe("GetStateGreeter: Without GetStateEntry", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new GetStateGreeter(),
      "/dev.restate.TestGreeter/Greet",
      [startMessage(1), inputMessage(greetRequest("Till"))]
    ).run();

    expect(result).toStrictEqual([getStateMessage("STATE")]);
  });
});

describe("GetStateGreeter: Without GetStateEntry and completed with later CompletionFrame", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new GetStateGreeter(),
      "/dev.restate.TestGreeter/Greet",
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
      "/dev.restate.TestGreeter/Greet",
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

describe("GetStateGreeter: GetState gets a failure back from the runtime", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new GetStateGreeter(),
      "/dev.restate.TestGreeter/Greet",
      [
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(
          1,
          undefined,
          undefined,
          Failure.create({ code: 13, message: "Error: couldn't get state" })
        ),
      ]
    ).run();

    expect(result).toStrictEqual([getStateMessage("STATE"), outputMessage()]);
  });
});
