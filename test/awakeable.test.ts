import { describe, expect } from "@jest/globals";
import * as restate from "../src/public_api";
import { TestDriver } from "./testdriver";
import {
  awakeableMessage,
  completeAwakeableMessage,
  completionMessage,
  greetRequest,
  greetResponse,
  inputMessage,
  outputMessage,
  startMessage,
  suspensionMessage,
} from "./protoutils";
import { AwakeableIdentifier } from "../src/types/protocol";
import {
  protoMetadata,
  TestGreeter,
  TestRequest,
  TestResponse,
} from "../src/generated/proto/test";
import { ProtocolMode } from "../src/generated/proto/discovery";

class AwakeableGreeter implements TestGreeter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    const result = await ctx.awakeable<string>();

    return TestResponse.create({ greeting: `Hello ${result}` });
  }
}

class CompleteAwakeableGreeter implements TestGreeter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    const awakeableIdentifier = new AwakeableIdentifier(
      "TestGreeter",
      Buffer.from("123"),
      Buffer.from("abcd"),
      1
    );
    ctx.completeAwakeable(awakeableIdentifier, "hello");

    return TestResponse.create({ greeting: `Hello` });
  }
}

describe("AwakeableGreeter: with awakeable completion replay", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new AwakeableGreeter(),
      "/test.TestGreeter/Greet",
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
      "/test.TestGreeter/Greet",
      [startMessage(1), inputMessage(greetRequest("Till"))]
    ).run();

    expect(result).toStrictEqual([awakeableMessage(), suspensionMessage([1])]);
  });
});

describe("AwakeableGreeter: request-response case", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new AwakeableGreeter(),
      "/test.TestGreeter/Greet",
      [startMessage(1), inputMessage(greetRequest("Till"))],
      ProtocolMode.REQUEST_RESPONSE
    ).run();

    expect(result).toStrictEqual([awakeableMessage(), suspensionMessage([1])]);
  });
});

describe("AwakeableGreeter: with completion", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new AwakeableGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(1, JSON.stringify("Francesco")),
      ]
    ).run();

    // BIDI mode: No suspension message because the completion will arrive before the timeout.
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
      "/test.TestGreeter/Greet",
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
