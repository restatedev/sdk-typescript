import { describe, expect } from "@jest/globals";
import * as restate from "../src/public_api";
import { TestDriver } from "../src/testdriver";
import {
  getStateMessage,
  greetRequest,
  greetResponse,
  inputMessage,
  invokeMessage,
  outputMessage,
  setStateMessage,
  startMessage,
} from "./protoutils";
import {
  protoMetadata,
  TestGreeter,
  TestGreeterClientImpl,
  TestRequest,
  TestResponse
} from "../src/generated/proto/test";

export class GreeterService implements TestGreeter {
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    // state
    let seen: number = (await ctx.get<number>("seen")) || 0;

    console.debug("The current state is " + seen);
    seen += 1;

    console.debug("Writing new state: " + seen);
    ctx.set<number>("seen", seen);

    const client = new TestGreeterClientImpl(ctx);
    const greeting = await client.greet(request);

    // return the final response

    return TestResponse.create({
      greeting: `YAGM (yet another greeting method) ${request.name}!`,
    });
  }
}


describe("TestGreeter/Greet", () => {
  it("should call Greet and return the get state entry message", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new GreeterService(),
      "/dev.restate.TestGreeter/Greet",
      [startMessage(1), inputMessage(greetRequest("bob"))]
    ).run();

    expect(result).toStrictEqual([getStateMessage("seen")]);
  });
});

describe("TestGreeter/Greet2", () => {
  it("should call Greet and have a completed get state message", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new GreeterService(),
      "/dev.restate.TestGreeter/Greet",
      [
        startMessage(2),
        inputMessage(greetRequest("bob")),
        getStateMessage("seen", 5),
      ]
    ).run();

    expect(result).toStrictEqual([
      setStateMessage("seen", 6),
      invokeMessage("dev.restate.TestGreeter", "Greet", greetRequest("bob")),
    ]);
  });
});

describe("TestGreeter/Greet3", () => {
  it("should call Greet, get state, set state and then call", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new GreeterService(),
      "/dev.restate.TestGreeter/Greet",
      [
        startMessage(3),
        inputMessage(greetRequest("bob")),
        getStateMessage("seen", 5),
        setStateMessage("seen", 6),
      ]
    ).run();

    expect(result).toStrictEqual([
      invokeMessage("dev.restate.TestGreeter", "Greet", greetRequest("bob")),
    ]);
  });
});
