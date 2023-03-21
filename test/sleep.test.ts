import { describe, expect } from "@jest/globals";
import * as restate from "../src/public_api";
import { TestDriver } from "../src/testdriver";
import {
  inputMessage,
  startMessage,
  completionMessage,
  outputMessage,
  greetRequest,
  greetResponse,
  sleepMessage,
} from "./protoutils";
import { SLEEP_ENTRY_MESSAGE_TYPE } from "../src/protocol_stream";
import { Empty } from "../src/generated/google/protobuf/empty";
import { protoMetadata, TestGreeter, TestRequest, TestResponse } from "../src/generated/proto/test";

export class SleepGreeter implements TestGreeter {
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    await ctx.sleep(1000);

    return TestResponse.create({ greeting: `Hello` });
  }
}

describe("SleepGreeter: With sleep not complete", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new SleepGreeter(),
      "/dev.restate.TestGreeter/Greet",
      [startMessage(1), inputMessage(greetRequest("Till"))]
    ).run();

    expect(result[0].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
  });
});

describe("SleepGreeter: With sleep already complete", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new SleepGreeter(),
      "/dev.restate.TestGreeter/Greet",
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
      "/dev.restate.TestGreeter/Greet",
      [
        startMessage(2),
        inputMessage(greetRequest("Till")),
        sleepMessage(1000, Empty.create({})),
      ]
    ).run();

    expect(result[0]).toStrictEqual(outputMessage(greetResponse("Hello")));
  });
});
