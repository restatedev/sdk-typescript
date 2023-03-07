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

export class GetAndSetGreeter implements Greeter {
  async greet(request: GreetRequest): Promise<GreetResponse> {
    const ctx = restate.useContext(this);

    // state
    const state = (await ctx.getState<string>("STATE")) || "nobody";
    console.log("Current state is " + state);

    ctx.setState("STATE", request.name);

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
    TestDriver.setupAndRun(
      protoMetadata, "Greeter", new GetAndSetGreeter(), "/dev.restate.Greeter/Greet", 
      [
        startMessage(3),
        inputMessage(GreetRequest.encode(GreetRequest.create({ name: "Till" })).finish()),
        getStateMessageCompletion("STATE", "Francesco"),
        setStateMessage("STATE", "Till")
      ])
      .then((result) => {
        const response = GreetResponse.decode(result[0].message.value);
        expect(response).toStrictEqual(GreetResponse.create({greeting: "Hello Francesco"}))
      });
  });
});

describe("GetAndSetGreeter: With GetState and SetState", () => {
  it("should call greet", async () => {
    TestDriver.setupAndRun(
      protoMetadata, "Greeter", new GetAndSetGreeter(), "/dev.restate.Greeter/Greet", 
      [
        startMessage(2),
        inputMessage(GreetRequest.encode(GreetRequest.create({ name: 'Till' })).finish()),
        getStateMessageCompletion("STATE", 'Francesco')
      ])
      .then((result) => {
        expect(result[0].message_type).toStrictEqual(SET_STATE_ENTRY_MESSAGE_TYPE)
        expect(result[0].message.key.toString()).toStrictEqual("STATE")
        expect(JSON.parse(result[0].message.value.toString())).toStrictEqual('Till')
      });
  });
});


