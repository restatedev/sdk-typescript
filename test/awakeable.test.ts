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

export class AwakeableGreeter implements Greeter {
  async greet(request: GreetRequest): Promise<GreetResponse> {
    const ctx = restate.useContext(this);

    const result = await ctx.awakeable<string>();

    return GreetResponse.create({ greeting: `Hello ${result}` });
  }

  async multiWord(request: GreetRequest): Promise<GreetResponse> {
    return GreetResponse.create({
      greeting: `YAGM (yet another greeting method) ${request.name}!`,
    });
  }
}

export class CompleteAwakeableGreeter implements Greeter {
  async greet(request: GreetRequest): Promise<GreetResponse> {
    const ctx = restate.useContext(this);

    const awakeableIdentifier = new AwakeableIdentifier(
      "Greeter",
      Buffer.from("123"),
      Buffer.from("abcd"),
      1
    );
    await ctx.completeAwakeable(awakeableIdentifier, "hello");

    return GreetResponse.create({ greeting: `Hello` });
  }

  async multiWord(request: GreetRequest): Promise<GreetResponse> {
    return GreetResponse.create({
      greeting: `YAGM (yet another greeting method) ${request.name}!`,
    });
  }
}

describe("AwakeableGreeter: with awakeable completion replay", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "Greeter",
      new AwakeableGreeter(),
      "/dev.restate.Greeter/Greet",
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
      "Greeter",
      new AwakeableGreeter(),
      "/dev.restate.Greeter/Greet",
      [startMessage(1), inputMessage(greetRequest("Till"))]
    ).run();

    expect(result).toStrictEqual([
      awakeableMessage(
        new AwakeableIdentifier(
          "Greeter",
          Buffer.from("123"),
          Buffer.from("abcd"),
          1
        )
      ),
    ]);
  });
});

describe("AwakeableGreeter: with completion", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "Greeter",
      new AwakeableGreeter(),
      "/dev.restate.Greeter/Greet",
      [
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(1, JSON.stringify("Francesco")),
      ]
    ).run();

    expect(result).toStrictEqual([
      awakeableMessage(
        new AwakeableIdentifier(
          "Greeter",
          Buffer.from("123"),
          Buffer.from("abcd"),
          1
        )
      ),
      outputMessage(greetResponse("Hello Francesco")),
    ]);
  });
});

describe("CompleteAwakeableGreeter: without completion", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "Greeter",
      new CompleteAwakeableGreeter(),
      "/dev.restate.Greeter/Greet",
      [startMessage(1), inputMessage(greetRequest("Till"))]
    ).run();

    expect(result).toStrictEqual([
      completeAwakeableMessage(
        "Greeter",
        Buffer.from("123"),
        Buffer.from("abcd"),
        1,
        "hello"
      ),
      outputMessage(greetResponse("Hello")),
    ]);
  });
});
