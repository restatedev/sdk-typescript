import { describe, expect } from "@jest/globals";
import * as restate from "../src/public_api";
import { TestDriver } from "../src/testdriver";
import {
  completionMessage,
  inputMessage,
  outputMessage,
  sideEffectMessage,
  startMessage,
  greetRequest,
  greetResponse,
} from "./protoutils";
import { SIDE_EFFECT_ENTRY_MESSAGE_TYPE, } from "../src/protocol_stream"
import { Message } from "../src/types";
import { protoMetadata, TestGreeter, TestRequest, TestResponse } from "../src/generated/proto/test";

export class SideEffectGreeter implements TestGreeter {
  constructor(readonly sideEffectOutput: string) {}

  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    // state
    const response = await ctx.sideEffect(async () => {
      return this.sideEffectOutput;
    });

    return TestResponse.create({ greeting: `Hello ${response}` });
  }
}

export class NumericSideEffectGreeter implements TestGreeter {
  constructor(readonly sideEffectOutput: number) {}

  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    // state
    const response = ctx.sideEffect(async () => {
      return this.sideEffectOutput;
    });

    return TestResponse.create({ greeting: `Hello ${response}` });
  }
}

describe("SideEffectGreeter: without ack", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new SideEffectGreeter("Francesco"),
      "/dev.restate.TestGreeter/Greet",
      [startMessage(1), inputMessage(greetRequest("Till"))]
    ).run();

    expect(result).toStrictEqual([
      new Message(
        SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
        Buffer.from(JSON.stringify("Francesco"))
      ),
    ]);
  });
});

describe("SideEffectGreeter: with ack", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new SideEffectGreeter("Francesco"),
      "/dev.restate.TestGreeter/Greet",
      [
        startMessage(2),
        inputMessage(greetRequest("Till")),
        sideEffectMessage("Francesco"),
      ]
    ).run();

    expect(result).toStrictEqual([
      outputMessage(greetResponse("Hello Francesco")),
    ]);
  });
});

describe("SideEffectGreeter: with completion", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new SideEffectGreeter("Francesco"),
      "/dev.restate.TestGreeter/Greet",
      [
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(1, "Francesco"),
      ]
    ).run();

    expect(result).toStrictEqual([
      new Message(
        SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
        Buffer.from(JSON.stringify("Francesco"))
      ),
      outputMessage(greetResponse("Hello Francesco")),
    ]);
  });
});

describe("SideEffectGreeter: without ack - numeric output", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new NumericSideEffectGreeter(123),
      "/dev.restate.TestGreeter/Greet",
      [startMessage(1), inputMessage(greetRequest("Till"))]
    ).run();

    expect(result).toStrictEqual([
      new Message(
        SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
        Buffer.from(JSON.stringify(123))
      ),
    ]);
  });
});
