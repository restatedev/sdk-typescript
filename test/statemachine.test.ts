import { describe, expect } from "@jest/globals";
import {
  GreetRequest,
  GreetResponse,
  Greeter,
  GreeterClientImpl,
  protoMetadata,
} from "../src/generated/proto/example";
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

export class GreeterService implements Greeter {
  async greet(request: GreetRequest): Promise<GreetResponse> {
    return GreetResponse.create({ greeting: `Hello ${request.name}` });
  }

  async multiWord(request: GreetRequest): Promise<GreetResponse> {
    const ctx = restate.useContext(this);

    // state
    let seen: number = (await ctx.get<number>("seen")) || 0;

    console.debug("The current state is " + seen);
    seen += 1;

    console.debug("Writing new state: " + seen);
    ctx.set<number>("seen", seen);

    const client = new GreeterClientImpl(ctx);
    const greeting = await client.greet(request);

    // return the final response

    return GreetResponse.create({
      greeting: `YAGM (yet another greeting method) ${request.name}!`,
    });
  }
}

describe("Greeter/Greeter", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "Greeter",
      new GreeterService(),
      "/dev.restate.Greeter/Greet",
      [startMessage(1), inputMessage(greetRequest("bob"))]
    ).run();

    expect(result).toStrictEqual([outputMessage(greetResponse("Hello bob"))]);
  });
});

describe("Greeter/MultiWord", () => {
  it("should call multiword and return the get state entry message", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "Greeter",
      new GreeterService(),
      "/dev.restate.Greeter/MultiWord",
      [startMessage(1), inputMessage(greetRequest("bob"))]
    ).run();

    expect(result).toStrictEqual([getStateMessage("seen")]);
  });
});

describe("Greeter/MultiWord2", () => {
  it("should call multiword and have a completed get state message", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "Greeter",
      new GreeterService(),
      "/dev.restate.Greeter/MultiWord",
      [
        startMessage(2),
        inputMessage(greetRequest("bob")),
        getStateMessage("seen", 5),
      ]
    ).run();

    expect(result).toStrictEqual([
      setStateMessage("seen", 6),
      invokeMessage("dev.restate.Greeter", "Greet", greetRequest("bob")),
    ]);
  });
});

describe("Greeter/MultiWord3", () => {
  it("should call multiword, get state, set state and then call", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "Greeter",
      new GreeterService(),
      "/dev.restate.Greeter/MultiWord",
      [
        startMessage(3),
        inputMessage(greetRequest("bob")),
        getStateMessage("seen", 5),
        setStateMessage("seen", 6),
      ]
    ).run();

    expect(result).toStrictEqual([
      invokeMessage("dev.restate.Greeter", "Greet", greetRequest("bob")),
    ]);
  });
});
