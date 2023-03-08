import { describe, expect } from "@jest/globals";
import {
  GET_STATE_ENTRY_MESSAGE_TYPE,
} from "../src/protocol_stream";
import {
  GreetRequest,
  GreetResponse,
  Greeter,
  protoMetadata,
} from "../src/generated/proto/example";
import * as restate from "../src/public_api";
import { TestDriver } from "../src/testdriver";
import { getStateMessage, 
  getStateMessageCompletion, 
  inputMessage, 
  startMessage, 
  completionMessage, 
  emptyCompletionMessage } from "../src/protoutils";

export class GetStateGreeter implements Greeter {
  async greet(request: GreetRequest): Promise<GreetResponse> {
    const ctx = restate.useContext(this);

    // state
    const state = (await ctx.getState<string>("STATE")) || "nobody";
    console.log("Current state is " + state);

    return GreetResponse.create({ greeting: `Hello ${state}` });
  }

  async multiWord(request: GreetRequest): Promise<GreetResponse> {
    return GreetResponse.create({
      greeting: `YAGM (yet another greeting method) ${request.name}!`,
    });
  }
}

describe("GetStateGreeter: With GetStateEntry already complete", () => {
  it("should call greet", async () => {
    TestDriver.setupAndRun(
      protoMetadata, "Greeter", new GetStateGreeter(), "/dev.restate.Greeter/Greet", 
      [
        startMessage(2),
        inputMessage(GreetRequest.encode(GreetRequest.create({ name: "Till" })).finish()),
        getStateMessageCompletion("STATE", "Francesco")
      ])
      .then((result) => {
        const response = GreetResponse.decode(result[0].message.value);
        expect(response).toStrictEqual(GreetResponse.create({greeting: "Hello Francesco"}))
      });
  });
});

describe("GetStateGreeter: Without GetStateEntry", () => {
    it("should call greet", async () => {
      TestDriver.setupAndRun(
        protoMetadata, "Greeter", new GetStateGreeter(), "/dev.restate.Greeter/Greet", 
        [
            startMessage(1),
            inputMessage(GreetRequest.encode(GreetRequest.create({ name: "Till" })).finish())
        ])
        .then((result) => {
            expect(result[0].message_type).toStrictEqual(GET_STATE_ENTRY_MESSAGE_TYPE)
            expect(result[0].message).toStrictEqual(getStateMessage("STATE").message)
        });
    });
});

describe("GetStateGreeter: Without GetStateEntry and completed with later CompletionFrame", () => {
    it("should call greet", async () => {
    TestDriver.setupAndRun(
        protoMetadata, "Greeter", new GetStateGreeter(), "/dev.restate.Greeter/Greet", 
        [
        startMessage(2),
        inputMessage(GreetRequest.encode(GreetRequest.create({ name: "Till" })).finish()),
        completionMessage(1, JSON.stringify('Francesco'))
        ])
        .then((result) => {
          const response = GreetResponse.decode(result[0].message.value);
          expect(response).toStrictEqual(GreetResponse.create({greeting: "Hello Francesco"}))
        });
    });
});

describe("GetStateGreeter: Without GetStateEntry and completed with later CompletionFrame with Empty state", () => {
  it("should call greet", async () => {
  TestDriver.setupAndRun(
      protoMetadata, "Greeter", new GetStateGreeter(), "/dev.restate.Greeter/Greet", 
      [
      startMessage(2),
      inputMessage(GreetRequest.encode(GreetRequest.create({ name: "Till" })).finish()),
      emptyCompletionMessage(1)
      ])
      .then((result) => {
        const response = GreetResponse.decode(result[0].message.value);
        expect(response).toStrictEqual(GreetResponse.create({greeting: "Hello nobody"}))
      });
  });
});