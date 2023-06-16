import {
  TestGreeter,
  TestRequest,
  TestResponse,
} from "../src/generated/proto/test";
import * as restate from "../src/public_api";
import { describe, expect } from "@jest/globals";
import { TestDriver } from "./testdriver";
import {
  greetRequest,
  greetResponse,
  inputMessage,
  outputMessage,
  startMessage,
} from "./protoutils";

class Greeter implements TestGreeter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const ctx = restate.useContext(this);

    return TestResponse.create({ greeting: `Hello` });
  }
}

describe("Greeter", () => {
  it("sends message to runtime", async () => {
    const result = await new TestDriver(new Greeter(), [
      startMessage(1),
      inputMessage(greetRequest("Pete")),
    ]).run();

    expect(result).toStrictEqual([outputMessage(greetResponse("Hello"))]);
  });

  it("handles replay of output message", async () => {
    const result = await new TestDriver(new Greeter(), [
      startMessage(2),
      inputMessage(greetRequest("Pete")),
      outputMessage(greetResponse("Hello")),
    ]).run();

    expect(result).toStrictEqual([]);
  });
});