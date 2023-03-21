import { describe, expect } from "@jest/globals";
import * as restate from "../src/public_api";
import { TestDriver } from "../src/testdriver";
import {
  inputMessage,
  outputMessage,
  startMessage,
  completionMessage,
  awakeableMessage,
  greetRequest,
  greetResponse,
  completeAwakeableMessage,
} from "./protoutils";
import { AwakeableIdentifier } from "../src/types";
import { protoMetadata, TestGreeter, TestRequest, TestResponse } from "../src/generated/proto/test";

export class AwakeableGreeter implements TestGreeter {
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    const result = await ctx.awakeable<string>();

    return TestResponse.create({ greeting: `Hello ${result}` });
  }
}

export class CompleteAwakeableGreeter implements TestGreeter {
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    const awakeableIdentifier = new AwakeableIdentifier(
      "TestGreeter",
      Buffer.from("123"),
      Buffer.from("abcd"),
      1
    );
    await ctx.completeAwakeable(awakeableIdentifier, "hello");

    return TestResponse.create({ greeting: `Hello` });
  }
}

describe("AwakeableGreeter: with awakeable completion replay", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new AwakeableGreeter(),
      "/dev.restate.TestGreeter/Greet",
      [
        startMessage(2),
        inputMessage(greetRequest("Till")),
        awakeableMessage("Francesco"),
      ]
    ).run();

    expect(result).toStrictEqual([
      outputMessage(greetResponse("Hello Francesco")),
    ]);
  });
});

describe("AwakeableGreeter: without completion", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new AwakeableGreeter(),
      "/dev.restate.TestGreeter/Greet",
      [startMessage(1), inputMessage(greetRequest("Till"))]
    ).run();

    expect(result).toStrictEqual([awakeableMessage()]);
  });
});

describe("AwakeableGreeter: with completion", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new AwakeableGreeter(),
      "/dev.restate.TestGreeter/Greet",
      [
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(1, JSON.stringify("Francesco")),
      ]
    ).run();

    expect(result).toStrictEqual([
      awakeableMessage(),
      outputMessage(greetResponse("Hello Francesco")),
    ]);
  });
});

describe("CompleteAwakeableGreeter: without completion", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new CompleteAwakeableGreeter(),
      "/dev.restate.TestGreeter/Greet",
      [startMessage(1), inputMessage(greetRequest("Till"))]
    ).run();

    expect(result).toStrictEqual([
      completeAwakeableMessage(
        "TestGreeter",
        Buffer.from("123"),
        Buffer.from("abcd"),
        1,
        "hello"
      ),
      outputMessage(greetResponse("Hello")),
    ]);
  });
});
