import { describe, expect } from "@jest/globals";
import {
  GreetRequest,
  GreetResponse,
  Greeter,
  protoMetadata,
  GreeterClientImpl,
} from "../src/generated/proto/example";
import * as restate from "../src/public_api";
import { TestDriver } from "../src/testdriver";
import {
  inputMessage,
  startMessage,
  invokeMessage,
  invokeMessageCompletion,
  completionMessage,
  outputMessage,
  setStateMessage,
  backgroundInvokeMessage,
  greetRequest,
  greetResponse,
} from "./protoutils";

export class ReverseAwaitOrder implements Greeter {
  async greet(request: GreetRequest): Promise<GreetResponse> {
    const ctx = restate.useContext(this);

    const client = new GreeterClientImpl(ctx);
    const greetingPromise1 = client.greet(
      GreetRequest.create({ name: "Francesco" })
    );
    const greetingPromise2 = client.greet(
      GreetRequest.create({ name: "Till" })
    );

    const greeting2 = await greetingPromise2;
    console.debug("Greeting 2 is " + greeting2.greeting);
    ctx.set<string>("A2", greeting2.greeting);

    const greeting1 = await greetingPromise1;

    return GreetResponse.create({
      greeting: `Hello ${greeting1.greeting}-${greeting2.greeting}`,
    });
  }

  async multiWord(request: GreetRequest): Promise<GreetResponse> {
    return GreetResponse.create({
      greeting: `YAGM (yet another greeting method) ${request.name}!`,
    });
  }
}

export class BackgroundInvokeGreeter implements Greeter {
  async greet(request: GreetRequest): Promise<GreetResponse> {
    const ctx = restate.useContext(this);

    const client = new GreeterClientImpl(ctx);
    await ctx.inBackground(() =>
      client.greet(GreetRequest.create({ name: "Francesco" }))
    );

    return GreetResponse.create({ greeting: `Hello` });
  }

  async multiWord(request: GreetRequest): Promise<GreetResponse> {
    return GreetResponse.create({
      greeting: `YAGM (yet another greeting method) ${request.name}!`,
    });
  }
}

describe("ReverseAwaitOrder: None completed", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "Greeter",
      new ReverseAwaitOrder(),
      "/dev.restate.Greeter/Greet",
      [startMessage(1), inputMessage(greetRequest("Till"))]
    ).run();

    expect(result).toStrictEqual([
      invokeMessage("dev.restate.Greeter", "Greet", greetRequest("Francesco")),
      invokeMessage("dev.restate.Greeter", "Greet", greetRequest("Till")),
    ]);
  });
});

describe("ReverseAwaitOrder: A1 and A2 completed later", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "Greeter",
      new ReverseAwaitOrder(),
      "/dev.restate.Greeter/Greet",
      [
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(1, greetResponse("FRANCESCO")),
        completionMessage(2, greetResponse("TILL")),
      ]
    ).run();

    expect(result).toStrictEqual([
      invokeMessage("dev.restate.Greeter", "Greet", greetRequest("Francesco")),
      invokeMessage("dev.restate.Greeter", "Greet", greetRequest("Till")),
      setStateMessage("A2", "TILL"),
      outputMessage(greetResponse("Hello FRANCESCO-TILL")),
    ]);
  });
});

describe("ReverseAwaitOrder: A2 and A1 completed later", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "Greeter",
      new ReverseAwaitOrder(),
      "/dev.restate.Greeter/Greet",
      [
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(2, greetResponse("TILL")),
        completionMessage(1, greetResponse("FRANCESCO")),
      ]
    ).run();

    expect(result).toStrictEqual([
      invokeMessage("dev.restate.Greeter", "Greet", greetRequest("Francesco")),
      invokeMessage("dev.restate.Greeter", "Greet", greetRequest("Till")),
      setStateMessage("A2", "TILL"),
      outputMessage(greetResponse("Hello FRANCESCO-TILL")),
    ]);
  });
});

describe("ReverseAwaitOrder: replay all invoke messages and setstate ", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "Greeter",
      new ReverseAwaitOrder(),
      "/dev.restate.Greeter/Greet",
      [
        startMessage(4),
        inputMessage(greetRequest("Till")),
        invokeMessageCompletion(
          "dev.restate.Greeter",
          "Greet",
          greetRequest("Francesco"),
          greetResponse("FRANCESCO")
        ),
        invokeMessageCompletion(
          "dev.restate.Greeter",
          "Greet",
          greetRequest("Till"),
          greetResponse("TILL")
        ),
        setStateMessage("A2", "TILL"),
      ]
    ).run();

    expect(result).toStrictEqual([
      outputMessage(greetResponse("Hello FRANCESCO-TILL")),
    ]);
  });
});

// async calls
describe("BackgroundInvokeGreeter: background call ", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "Greeter",
      new BackgroundInvokeGreeter(),
      "/dev.restate.Greeter/Greet",
      [startMessage(1), inputMessage(greetRequest("Till"))]
    ).run();

    expect(result).toStrictEqual([
      backgroundInvokeMessage(
        "dev.restate.Greeter",
        "Greet",
        greetRequest("Francesco")
      ),
      outputMessage(greetResponse("Hello")),
    ]);
  });
});

// TODO also implement the other tests of the Java SDK.
