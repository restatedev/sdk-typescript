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
import { inputMessage, 
  startMessage, 
  invokeMessage,
  invokeMessageCompletion,
  completionMessage, 
  outputMessage,
  setStateMessage,
  backgroundInvokeMessage} from "../src/protoutils";

export class ReverseAwaitOrder implements Greeter {
  async greet(request: GreetRequest): Promise<GreetResponse> {
    const ctx = restate.useContext(this);

    const client = new GreeterClientImpl(ctx);
    const greetingPromise1 = client.greet(GreetRequest.create({name: "Francesco"}));
    const greetingPromise2 = client.greet(GreetRequest.create({name: "Till"}));

    const greeting2 = (await greetingPromise2).greeting;
    await ctx.setState<string>("A2", greeting2);
    
    const greeting1 = (await greetingPromise1).greeting;

    return GreetResponse.create({ greeting: `Hello ${greeting1}-${greeting2}` })
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
    await ctx.inBackground( () => client.greet(GreetRequest.create({name: "Francesco"})));

    return GreetResponse.create({ greeting: `Hello` })
  }

  async multiWord(request: GreetRequest): Promise<GreetResponse> {
    return GreetResponse.create({
      greeting: `YAGM (yet another greeting method) ${request.name}!`,
    });
  }
}

describe("ReverseAwaitOrder: None completed", () => {
  it("should call greet", async () => {
    TestDriver.setupAndRun(
      protoMetadata, "Greeter", new ReverseAwaitOrder(), "/dev.restate.Greeter/Greet", 
      [
        startMessage(1),
        inputMessage(GreetRequest.encode(GreetRequest.create({ name: "Till" })).finish()),
      ])
    .then((result) => {
        expect(result).toStrictEqual(
          [
            invokeMessage("dev.restate.Greeter", "Greet", 
              GreetRequest.encode(GreetRequest.create({ name: "Francesco" })).finish()),
            invokeMessage("dev.restate.Greeter", "Greet", 
              GreetRequest.encode(GreetRequest.create({ name: "Till" })).finish())
          ]);
    });
  });
});

describe("ReverseAwaitOrder: A1 and A2 completed later", () => {
  it("should call greet", async () => {
    TestDriver.setupAndRun(
      protoMetadata, "Greeter", new ReverseAwaitOrder(), "/dev.restate.Greeter/Greet", 
      [
        startMessage(1),
        inputMessage(GreetRequest.encode(GreetRequest.create({ name: "Till" })).finish()),
        completionMessage(1, GreetResponse.encode(GreetResponse.create({ greeting: "FRANCESCO" })).finish()),
        completionMessage(2, GreetResponse.encode(GreetResponse.create({ greeting: "TILL" })).finish()),
      ])
    .then((result) => {
      expect(result).toStrictEqual([
        invokeMessage("dev.restate.Greeter", "Greet", GreetRequest.encode(GreetRequest.create({ name: "Francesco" })).finish()),
        invokeMessage("dev.restate.Greeter", "Greet", GreetRequest.encode(GreetRequest.create({ name: "Till" })).finish()),
        setStateMessage("A2", "TILL"),
        outputMessage(GreetResponse.encode(GreetResponse.create({greeting: "Hello FRANCESCO-TILL"})).finish())
      ])
    });
  });
});

describe("ReverseAwaitOrder: A2 and A1 completed later", () => {
  it("should call greet", async () => {
    TestDriver.setupAndRun(
      protoMetadata, "Greeter", new ReverseAwaitOrder(), "/dev.restate.Greeter/Greet", 
      [
        startMessage(1),
        inputMessage(GreetRequest.encode(GreetRequest.create({ name: "Till" })).finish()),
        completionMessage(2, GreetResponse.encode(GreetResponse.create({ greeting: "TILL" })).finish()),
        completionMessage(1, GreetResponse.encode(GreetResponse.create({ greeting: "FRANCESCO" })).finish()),
      ])
    .then((result) => {
      expect(result).toStrictEqual([
        invokeMessage("dev.restate.Greeter", "Greet", GreetRequest.encode(GreetRequest.create({ name: "Francesco" })).finish()),
        invokeMessage("dev.restate.Greeter", "Greet", GreetRequest.encode(GreetRequest.create({ name: "Till" })).finish()),
        setStateMessage("A2", "TILL"),
        outputMessage(GreetResponse.encode(GreetResponse.create({greeting: "Hello FRANCESCO-TILL"})).finish())
      ])
    });
  });
});

describe("ReverseAwaitOrder: Only A2 completed", () => {
  it("should call greet", async () => {
    TestDriver.setupAndRun(
      protoMetadata, "Greeter", new ReverseAwaitOrder(), "/dev.restate.Greeter/Greet", 
      [
        startMessage(1),
        inputMessage(GreetRequest.encode(GreetRequest.create({ name: "Till" })).finish()),
        completionMessage(2, GreetResponse.encode(GreetResponse.create({ greeting: "TILL" })).finish())
      ])
    .then((result) => {
      expect(result).toStrictEqual([
        invokeMessage("dev.restate.Greeter", "Greet", GreetRequest.encode(GreetRequest.create({ name: "Francesco" })).finish()),
        invokeMessage("dev.restate.Greeter", "Greet", GreetRequest.encode(GreetRequest.create({ name: "Till" })).finish()),
        setStateMessage("A2", "TILL")
      ])
    });
  });
});

describe("ReverseAwaitOrder: Only A1 completed", () => {
  it("should call greet", async () => {
    TestDriver.setupAndRun(
      protoMetadata, "Greeter", new ReverseAwaitOrder(), "/dev.restate.Greeter/Greet", 
      [
        startMessage(1),
        inputMessage(GreetRequest.encode(GreetRequest.create({ name: "Till" })).finish()),
        completionMessage(2, GreetResponse.encode(GreetResponse.create({ greeting: "FRANCESCO" })).finish())
      ])
    .then((result) => {
      expect(result).toStrictEqual([
        invokeMessage("dev.restate.Greeter", "Greet", GreetRequest.encode(GreetRequest.create({ name: "Francesco" })).finish()),
        invokeMessage("dev.restate.Greeter", "Greet", GreetRequest.encode(GreetRequest.create({ name: "Till" })).finish())
      ])
    });
  });
});

describe("ReverseAwaitOrder: replay invoke messages", () => {
  it("should call greet", async () => {
    TestDriver.setupAndRun(
      protoMetadata, "Greeter", new ReverseAwaitOrder(), "/dev.restate.Greeter/Greet", 
      [
        startMessage(4),
        inputMessage(GreetRequest.encode(GreetRequest.create({ name: "Till" })).finish()),
        invokeMessageCompletion("dev.restate.Greeter", "Greet", GreetRequest.encode(GreetRequest.create({ name: "Francesco" })).finish(),
          GreetResponse.encode(GreetResponse.create({ greeting: "Francesco" })).finish()),
        invokeMessageCompletion("dev.restate.Greeter", "Greet", GreetRequest.encode(GreetRequest.create({ name: "Till" })).finish(),
          GreetResponse.encode(GreetResponse.create({ greeting: "Till" })).finish()),
        setStateMessage("A2", "TILL")
      ])
    .then((result) => {
      console.debug(result)
      // expect(result).toStrictEqual([
      //   invokeMessage("dev.restate.Greeter", "Greet", GreetRequest.encode(GreetRequest.create({ name: "Francesco" })).finish()),
      //   invokeMessage("dev.restate.Greeter", "Greet", GreetRequest.encode(GreetRequest.create({ name: "Till" })).finish())
      // ])
    });
  });
});


// async calls
describe("BackgroundInvokeGreeter: background call ", () => {
  it("should call greet", async () => {
    TestDriver.setupAndRun(
      protoMetadata, "Greeter", new BackgroundInvokeGreeter(), "/dev.restate.Greeter/Greet", 
      [
        startMessage(1),
        inputMessage(GreetRequest.encode(GreetRequest.create({ name: "Till" })).finish())
      ])
    .then((result) => {
      expect(result).toStrictEqual([
        backgroundInvokeMessage("dev.restate.Greeter", "Greet", GreetRequest.encode(GreetRequest.create({ name: "Francesco" })).finish()),
        outputMessage(GreetResponse.encode(GreetResponse.create({greeting: "Hello"})).finish())
      ])
    });
  });
});

// TODO also implement the other tests of the Java SDK.