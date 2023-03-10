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
  getStateMessageCompletion,
  inputMessage,
  setStateMessage,
  startMessage,
  completionMessage,
  outputMessage,
  getStateMessage,
  greetResponse,
  greetRequest,
} from "./protoutils";

export class GetAndSetGreeter implements Greeter {
  async greet(request: GreetRequest): Promise<GreetResponse> {
    const ctx = restate.useContext(this);

    // state
    const state = (await ctx.get<string>("STATE")) || "nobody";
    console.log("Current state is " + state);

    ctx.set("STATE", request.name);

    return GreetResponse.create({ greeting: `Hello ${state}` });
  }

  async multiWord(request: GreetRequest): Promise<GreetResponse> {
    return GreetResponse.create({
      greeting: `YAGM (yet another greeting method) ${request.name}!`,
    });
  }
}

describe("GetAndSetGreeter: With GetState and SetState", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "Greeter",
      new GetAndSetGreeter(),
      "/dev.restate.Greeter/Greet",
      [
        startMessage(3),
        inputMessage(greetRequest("Till")),
        getStateMessageCompletion("STATE", "Francesco"),
        setStateMessage("STATE", "Till"),
      ]
    ).run();

    expect(result).toStrictEqual([
      outputMessage(greetResponse("Hello Francesco")),
    ]);
  });
});

describe("GetAndSetGreeter: With GetState already completed", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "Greeter",
      new GetAndSetGreeter(),
      "/dev.restate.Greeter/Greet",
      [
        startMessage(2),
        inputMessage(greetRequest("Till")),
        getStateMessageCompletion("STATE", "Francesco"),
      ]
    ).run();

    expect(result).toStrictEqual([
      setStateMessage("STATE", "Till"),
      outputMessage(greetResponse("Hello Francesco")),
    ]);
  });
});

describe("GetAndSetGreeter: With GetState completed later", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "Greeter",
      new GetAndSetGreeter(),
      "/dev.restate.Greeter/Greet",
      [
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(1, JSON.stringify("Francesco")),
      ]
    ).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      setStateMessage("STATE", "Till"),
      outputMessage(greetResponse("Hello Francesco")),
    ]);
  });
});
