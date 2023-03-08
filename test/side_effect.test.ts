import { describe, expect } from "@jest/globals";
import {
  GreetRequest,
  GreetResponse,
  Greeter,
  protoMetadata,
} from "../src/generated/proto/example";
import * as restate from "../src/public_api";
import { TestDriver } from "../src/testdriver";
import { getStateMessageCompletion, 
  inputMessage, 
  sideEffectMessage, 
  startMessage } from "../src/protoutils";
import { SIDE_EFFECT_ENTRY_MESSAGE_TYPE } from "../src/types";
import { OUTPUT_STREAM_ENTRY_MESSAGE_TYPE } from "../src/protocol_stream";

export class SideEffectGreeter implements Greeter {
  
  constructor(
    readonly sideEffectOutput: string
  ){}

  async greet(request: GreetRequest): Promise<GreetResponse> {
    const ctx = restate.useContext(this);

    // state
    const response = await ctx.withSideEffect(async () =>{
        return this.sideEffectOutput
    })

    return GreetResponse.create({ greeting: `Hello ${response}` });
  }

  async multiWord(request: GreetRequest): Promise<GreetResponse> {
    return GreetResponse.create({
      greeting: `YAGM (yet another greeting method) ${request.name}!`,
    });
  }
}

export class NumericSideEffectGreeter implements Greeter {
  
    constructor(
      readonly sideEffectOutput: number
    ){}
  
    async greet(request: GreetRequest): Promise<GreetResponse> {
      const ctx = restate.useContext(this);
  
      // state
      const response = await ctx.withSideEffect(async () =>{
          return this.sideEffectOutput;
      })
  
      return GreetResponse.create({ greeting: `Hello ${response}` });
    }
  
    async multiWord(request: GreetRequest): Promise<GreetResponse> {
      return GreetResponse.create({
        greeting: `YAGM (yet another greeting method) ${request.name}!`,
      });
    }
  }

describe("SideEffectGreeter: without ack", () => {
  it("should call greet", async () => {
    TestDriver.setupAndRun(
      protoMetadata, "Greeter", new SideEffectGreeter("Francesco"), "/dev.restate.Greeter/Greet", 
      [
        startMessage(1),
        inputMessage(GreetRequest.encode(GreetRequest.create({ name: "Till" })).finish())
      ])
      .then((result) => {
        expect(result.length).toStrictEqual(1);
        expect(result).toStrictEqual({
            message_type: SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
            message: Buffer.from(JSON.stringify("Francesco"))
        })
      });
  });
});

describe("SideEffectGreeter: with ack", () => {
    it("should call greet", async () => {
      TestDriver.setupAndRun(
        protoMetadata, "Greeter", new SideEffectGreeter("Francesco"), "/dev.restate.Greeter/Greet", 
        [
          startMessage(2),
          inputMessage(GreetRequest.encode(GreetRequest.create({ name: "Till" })).finish()),
          sideEffectMessage("Francesco")
        ])
        .then((result) => {
            const response = GreetResponse.decode(result[0].message.value);
            expect(response).toStrictEqual(GreetResponse.create({greeting: "Hello Francesco"}))
        });
    });
  });

  describe("SideEffectGreeter: without ack - numeric output", () => {
    it("should call greet", async () => {
      TestDriver.setupAndRun(
        protoMetadata, "Greeter", new NumericSideEffectGreeter(123), "/dev.restate.Greeter/Greet", 
        [
          startMessage(1),
          inputMessage(GreetRequest.encode(GreetRequest.create({ name: "Till" })).finish())
        ])
        .then((result) => {
          expect(result.length).toStrictEqual(1);
          expect(result).toStrictEqual({
              message_type: SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
              message: Buffer.from(JSON.stringify(123))
          })
        });
    });
  });