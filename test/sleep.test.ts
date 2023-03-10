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
  startMessage,
  completionMessage,
  outputMessage,
  greetRequest,
  greetResponse,
  sleepMessage,
} from "./protoutils";
import { SLEEP_ENTRY_MESSAGE_TYPE } from "../src/protocol_stream";

export class SleepGreeter implements Greeter {
  async greet(request: GreetRequest): Promise<GreetResponse> {
    const ctx = restate.useContext(this);

    await ctx.sleep(1000);

    return GreetResponse.create({ greeting: `Hello` });
  }

  async multiWord(request: GreetRequest): Promise<GreetResponse> {
    return GreetResponse.create({
      greeting: `YAGM (yet another greeting method) ${request.name}!`,
    });
  }
}

describe("SleepGreeter: With sleep not complete", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "Greeter",
      new SleepGreeter(),
      "/dev.restate.Greeter/Greet",
      [startMessage(1), inputMessage(greetRequest("Till"))]
    ).run();

    expect(result[0].message_type).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
  });
});

describe("SleepGreeter: With sleep already complete", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "Greeter",
      new SleepGreeter(),
      "/dev.restate.Greeter/Greet",
      [
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(1, undefined),
      ]
    ).run();

    expect(result[0].message_type).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result[1]).toStrictEqual(outputMessage(greetResponse("Hello")));
  });
});

describe("SleepGreeter: With sleep replayed", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "Greeter",
      new SleepGreeter(),
      "/dev.restate.Greeter/Greet",
      [startMessage(2), inputMessage(greetRequest("Till")), sleepMessage(1000)]
    ).run();

    expect(result[0]).toStrictEqual(outputMessage(greetResponse("Hello")));
  });
});
