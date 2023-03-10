import { describe, expect } from "@jest/globals";
import {
  GreetRequest,
  GreetResponse,
  Greeter,
  protoMetadata,
} from "../src/generated/proto/example";
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
import { SIDE_EFFECT_ENTRY_MESSAGE_TYPE, Message } from "../src/types";

export class SideEffectGreeter implements Greeter {
  constructor(readonly sideEffectOutput: string) {}

  async greet(request: GreetRequest): Promise<GreetResponse> {
    const ctx = restate.useContext(this);

    // state
    const response = await ctx.sideEffect(async () => {
      return this.sideEffectOutput;
    });

    return GreetResponse.create({ greeting: `Hello ${response}` });
  }

  async multiWord(request: GreetRequest): Promise<GreetResponse> {
    return GreetResponse.create({
      greeting: `YAGM (yet another greeting method) ${request.name}!`,
    });
  }
}

export class NumericSideEffectGreeter implements Greeter {
  constructor(readonly sideEffectOutput: number) {}

  async greet(request: GreetRequest): Promise<GreetResponse> {
    const ctx = restate.useContext(this);

    // state
    const response = ctx.sideEffect(async () => {
      return this.sideEffectOutput;
    });

    return GreetResponse.create({ greeting: `Hello ${response}` });
  }

  async multiWord(request: GreetRequest): Promise<GreetResponse> {
    return GreetResponse.create({
      greeting: `YAGM (yet another greeting method) ${request.name}!`,
    });
  }
}

describe("SideEffectGreeter: without ack", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "Greeter",
      new SideEffectGreeter("Francesco"),
      "/dev.restate.Greeter/Greet",
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
      "Greeter",
      new SideEffectGreeter("Francesco"),
      "/dev.restate.Greeter/Greet",
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
      "Greeter",
      new SideEffectGreeter("Francesco"),
      "/dev.restate.Greeter/Greet",
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
      "Greeter",
      new NumericSideEffectGreeter(123),
      "/dev.restate.Greeter/Greet",
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
