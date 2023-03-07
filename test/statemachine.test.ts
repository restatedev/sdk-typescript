import { describe, expect } from "@jest/globals";
import {
  GET_STATE_ENTRY_MESSAGE_TYPE,
  SET_STATE_ENTRY_MESSAGE_TYPE,
  INVOKE_ENTRY_MESSAGE_TYPE
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
import { getStateMessage, getStateMessageCompletion, inputMessage, setStateMessage, startMessage } from "../src/protoutils";

export class GreeterService implements Greeter {
  async greet(request: GreetRequest): Promise<GreetResponse> {
    return GreetResponse.create({ greeting: `Hello ${request.name}` });
  }

  async multiWord(request: GreetRequest): Promise<GreetResponse> {
    const ctx = restate.useContext(this);

    // state
    let seen: number = (await ctx.getState<number>("seen")) || 0;


    console.debug("The current state is " + seen);
    seen += 1;

    console.debug("Writing new state: " + seen);
    await ctx.setState<number>("seen", seen);

    // rpc
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
    TestDriver.setupAndRun(
      protoMetadata, "Greeter", new GreeterService(), "/dev.restate.Greeter/Greet", 
      [
        startMessage(1),
        inputMessage(GreetRequest.encode(GreetRequest.create({ name: "bob" })).finish())
      ])
      .then((result) => {
        const response = GreetResponse.decode(result[0].message.value);
        expect(response).toStrictEqual(GreetResponse.create({greeting: "Hello bob"}))
      });
  });
});

describe("Greeter/MultiWord", () => {
  it("should call multiword and return the get state entry message", async () => { 
    TestDriver.setupAndRun(
      protoMetadata, "Greeter", new GreeterService(), "/dev.restate.Greeter/MultiWord", 
      [
        startMessage(1),
        inputMessage(GreetRequest.encode(GreetRequest.create({ name: "bob" })).finish())
      ]
    ).then((result) => {
      expect(result[0].message_type).toStrictEqual(GET_STATE_ENTRY_MESSAGE_TYPE);
      expect(result[0].message.key.toString()).toStrictEqual("seen");
    });
  });
});

describe("Greeter/MultiWord2", () => {
  it("should call multiword and have a completed get state message", async () => {
    TestDriver.setupAndRun(
      protoMetadata, "Greeter", new GreeterService(), "/dev.restate.Greeter/MultiWord", 
        [
          startMessage(2),
          inputMessage(GreetRequest.encode(GreetRequest.create({ name: "bob" })).finish()), 
          getStateMessageCompletion("seen", 5)
        ]
    ).then((result) => {
        expect(result[0].message_type).toStrictEqual(SET_STATE_ENTRY_MESSAGE_TYPE);
        expect(result[0].message.key.toString()).toStrictEqual("seen"); 
        expect(JSON.parse(result[0].message.value.toString())).toStrictEqual(6); 
    });
  });
});

describe("Greeter/MultiWord3", () => {
  it("should call multiword, get state, set state and then call", async () => {
    TestDriver.setupAndRun(
      protoMetadata, "Greeter", new GreeterService(), "/dev.restate.Greeter/MultiWord",  
    [
      startMessage(3),
      inputMessage(GreetRequest.encode(GreetRequest.create({ name: "bob" })).finish()), 
      getStateMessageCompletion("seen", 5),
      setStateMessage("seen", 6)
     ]).then((result) => {
      expect(result[0].message_type).toStrictEqual(INVOKE_ENTRY_MESSAGE_TYPE);
      expect(result[0].message.serviceName).toStrictEqual("dev.restate.Greeter");
      expect(result[0].message.methodName).toStrictEqual("Greet");
     });
  });
});


