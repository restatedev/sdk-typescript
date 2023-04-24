import { describe, expect } from "@jest/globals";
import * as restate from "../src/public_api";
import { TestDriver } from "./testdriver";
import {
  clearStateMessage,
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
import {
  protoMetadata,
  TestGreeter,
  TestRequest,
  TestResponse,
} from "../src/generated/proto/test";
import { ProtocolMode } from "../src/generated/proto/discovery";

class GetAndSetGreeter implements TestGreeter {
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    // state
    const state = (await ctx.get<string>("STATE")) || "nobody";
    console.log("Current state is " + state);

    ctx.set("STATE", request.name);

    return TestResponse.create({ greeting: `Hello ${state}` });
  }
}

class ClearStateGreeter implements TestGreeter {
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    // state
    const state = (await ctx.get<string>("STATE")) || "nobody";
    console.log("Current state is " + state);

    ctx.set("STATE", request.name);

    ctx.clear("STATE");

    return TestResponse.create({ greeting: `Hello ${state}` });
  }
}

describe("GetAndSetGreeter: With GetState and SetState", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new GetAndSetGreeter(),
      "/dev.restate.TestGreeter/Greet",
      [
        startMessage(3),
        inputMessage(greetRequest("Till")),
        getStateMessage("STATE", "Francesco"),
        setStateMessage("STATE", "Till"),
      ]
    ).run();

    expect(result).toStrictEqual([
      outputMessage(greetResponse("Hello Francesco")),
    ]);
  });
});

describe("GetAndSetGreeter: With GetState already completed", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new GetAndSetGreeter(),
      "/dev.restate.TestGreeter/Greet",
      [
        startMessage(2),
        inputMessage(greetRequest("Till")),
        getStateMessage("STATE", "Francesco"),
      ]
    ).run();

    expect(result).toStrictEqual([
      setStateMessage("STATE", "Till"),
      outputMessage(greetResponse("Hello Francesco")),
    ]);
  });
});

describe("GetAndSetGreeter: With GetState completed later", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new GetAndSetGreeter(),
      "/dev.restate.TestGreeter/Greet",
      [
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(1, JSON.stringify("Francesco")),
      ]
    ).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      setStateMessage("STATE", "Till"),
      outputMessage(greetResponse("Hello Francesco")),
    ]);
  });
});

describe("GetAndSetGreeter: Request-response with GetState and suspension", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new GetAndSetGreeter(),
      "/dev.restate.TestGreeter/Greet",
      [startMessage(1), inputMessage(greetRequest("Till"))],
      ProtocolMode.REQUEST_RESPONSE
    ).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      suspensionMessage([1]),
    ]);
  });
});

describe("ClearState: With ClearState completed later", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new ClearStateGreeter(),
      "/dev.restate.TestGreeter/Greet",
      [
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(1, JSON.stringify("Francesco")),
      ]
    ).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      setStateMessage("STATE", "Till"),
      clearStateMessage("STATE"),
      outputMessage(greetResponse("Hello Francesco")),
    ]);
  });
});

describe("ClearState: With ClearState already completed", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new ClearStateGreeter(),
      "/dev.restate.TestGreeter/Greet",
      [
        startMessage(4),
        inputMessage(greetRequest("Till")),
        getStateMessage("STATE", "Francesco"),
        setStateMessage("STATE", "Till"),
        clearStateMessage("STATE"),
      ]
    ).run();

    expect(result).toStrictEqual([
      outputMessage(greetResponse("Hello Francesco")),
    ]);
  });
});
