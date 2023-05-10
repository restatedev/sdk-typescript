import { describe, expect } from "@jest/globals";
import * as restate from "../src/public_api";
import { TestDriver } from "./testdriver";
import {
  awakeableMessage,
  checkError,
  completionMessage,
  greetRequest,
  greetResponse,
  inputMessage,
  outputMessage,
  sleepMessage,
  startMessage,
  suspensionMessage,
} from "./protoutils";
import { SLEEP_ENTRY_MESSAGE_TYPE } from "../src/types/protocol";
import { Empty } from "../src/generated/google/protobuf/empty";
import {
  protoMetadata,
  TestGreeter,
  TestRequest,
  TestResponse,
} from "../src/generated/proto/test";
import { ProtocolMode } from "../src/generated/proto/discovery";

const wakeupTime = 1835661783000;

class SleepGreeter implements TestGreeter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    await ctx.sleep(wakeupTime - Date.now());

    return TestResponse.create({ greeting: `Hello` });
  }
}

describe("SleepGreeter: With sleep not complete", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new SleepGreeter(),
      "/test.TestGreeter/Greet",
      [startMessage(1), inputMessage(greetRequest("Till"))]
    ).run();

    expect(result[0].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result[1]).toStrictEqual(suspensionMessage([1]));
  });
});

describe("SleepGreeter: Request-response with sleep not complete", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new SleepGreeter(),
      "/test.TestGreeter/Greet",
      [startMessage(1), inputMessage(greetRequest("Till"))],
      ProtocolMode.REQUEST_RESPONSE
    ).run();

    expect(result[0].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result[1]).toStrictEqual(suspensionMessage([1]));
  });
});

describe("SleepGreeter: With sleep already complete", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new SleepGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(1, Empty.encode(Empty.create({})).finish()),
      ]
    ).run();

    expect(result[0].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result[1]).toStrictEqual(outputMessage(greetResponse("Hello")));
  });
});

describe("SleepGreeter: With sleep replayed", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new SleepGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(2),
        inputMessage(greetRequest("Till")),
        sleepMessage(wakeupTime, Empty.create({})),
      ]
    ).run();

    expect(result[0]).toStrictEqual(outputMessage(greetResponse("Hello")));
  });
});

describe("SleepGreeter: journal mismatch checks on sleep: Completed with awakeable on replay.", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new SleepGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(2),
        inputMessage(greetRequest("Till")),
        awakeableMessage(""), // should have been a sleep message
      ]
    ).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "Replayed journal entries did not correspond to the user code. The user code has to be deterministic!"
    );
  });
});
