import {
  protoMetadata,
  TestGreeter,
  TestGreeterClientImpl,
  TestRequest,
  TestResponse,
} from "../src/generated/proto/test";
import * as restate from "../src/public_api";
import { describe, expect } from "@jest/globals";
import { TestDriver } from "./testdriver";
import {
  completionMessage,
  greetRequest,
  greetResponse,
  inputMessage,
  outputMessage,
  startMessage,
} from "./protoutils";
import { Empty } from "../src/generated/google/protobuf/empty";

class Greeter implements TestGreeter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const ctx = restate.useContext(this);

    return TestResponse.create({ greeting: `Hello` });
  }
}

describe("Greeter", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new Greeter(),
      "/test.TestGreeter/Greet",
      [startMessage(1), inputMessage(greetRequest("Pete"))]
    ).run();

    expect(result).toStrictEqual([outputMessage(greetResponse("Hello"))]);
  });
});

describe("Greeter: replay output message", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new Greeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(2),
        inputMessage(greetRequest("Pete")),
        outputMessage(greetResponse("Hello")),
      ]
    ).run();

    expect(result).toStrictEqual([]);
  });
});
