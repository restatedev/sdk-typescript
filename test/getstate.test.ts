import { describe, expect } from "@jest/globals";
import {
  GET_STATE_ENTRY_MESSAGE_TYPE,
  SET_STATE_ENTRY_MESSAGE_TYPE,
  INVOKE_ENTRY_MESSAGE_TYPE,
  CompletionMessage
} from "../src/protocol_stream";
import {
  GreetRequest,
  GreetResponse,
  Greeter,
  GreeterClientImpl,
  protoMetadata,
} from "../src/generated/proto/example";
import * as restate from "../src/public_api";
import { TestDriver } from "../src/testdriver";
import { getStateMessage, getStateMessageCompletion, inputMessage, setStateMessage, startMessage, completionMessage } from "../src/protoutils";

export class GreeterService implements Greeter {
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

describe("Greeter/Greeter: With GetStateEntry already complete", () => {
  it("should call greet", async () => {
    TestDriver.setupAndRun(
      protoMetadata, "Greeter", new GreeterService(), "/dev.restate.Greeter/Greet", 
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

describe("Greeter/Greeter: Without GetStateEntry", () => {
    it("should call greet", async () => {
        TestDriver.setupAndRun(
        protoMetadata, "Greeter", new GreeterService(), "/dev.restate.Greeter/Greet", 
        [
            startMessage(1),
            inputMessage(GreetRequest.encode(GreetRequest.create({ name: "Till" })).finish())
        ])
        .then((result) => {
            expect(result[0].message_type).toStrictEqual(GET_STATE_ENTRY_MESSAGE_TYPE)
            expect(result[0]).toStrictEqual(
            getStateMessage("STATE"))
        });
    });
});

describe("Greeter/Greeter: With GetStateEntry not completed", () => {
    it("should call greet", async () => {
    TestDriver.setupAndRun(
        protoMetadata, "Greeter", new GreeterService(), "/dev.restate.Greeter/Greet", 
        [
        startMessage(2),
        inputMessage(GreetRequest.encode(GreetRequest.create({ name: "Till" })).finish()),
        completionMessage(1, "Francesco")
        ])
        .then((result) => {
          const response = GreetResponse.decode(result[0].message.value);
          expect(response).toStrictEqual(GreetResponse.create({greeting: "Hello Francesco"}))
        });
    });
});