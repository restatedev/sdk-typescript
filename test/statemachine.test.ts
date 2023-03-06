import { describe, expect } from "@jest/globals";
import {
  Header,
  START_MESSAGE_TYPE,
  COMPLETION_MESSAGE_TYPE,
  GET_STATE_ENTRY_MESSAGE_TYPE,
  POLL_INPUT_STREAM_ENTRY_MESSAGE_TYPE,
  RestateDuplexStream,
  OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
  SET_STATE_ENTRY_MESSAGE_TYPE,
  INVOKE_ENTRY_MESSAGE_TYPE
} from "../src/protocol_stream";
import { GetStateEntryMessage, OutputStreamEntryMessage, PollInputStreamEntryMessage, SetStateEntryMessage, StartMessage } from "../src/generated/proto/protocol";
import {
  GreetRequest,
  GreetResponse,
  Greeter,
  GreeterClientImpl,
  protoMetadata,
} from "../src/generated/proto/example";
import * as restate from "../src/public_api";
import { TestConnection } from "../src/bidirectional_server";
import { ServerHttp2Stream } from "http2";
import stream from "stream";
import {PROTOBUF_MESSAGE_BY_TYPE} from "../src/protocol_stream"
import { DurableExecutionStateMachine  } from "../src/durable_execution";
import { HostedGrpcServiceMethod } from "../src/core";
import exp from "constants";



export class GreeterService implements Greeter {
  async greet(request: GreetRequest): Promise<GreetResponse> {
    return GreetResponse.create({ greeting: `Hello ${request.name}` });
  }

  async multiWord(request: GreetRequest): Promise<GreetResponse> {
    const ctx = restate.useContext(this);

    // state
    let seen = (await ctx.getState<number>("seen")) || 0;

    console.log("The current state is " + seen);
    seen += 1;

    await ctx.setState("seen", seen);

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

      const http2stream = mockHttp2DuplexStream();
      const restateStream = RestateDuplexStream.from(http2stream);
      const connection = new TestConnection(http2stream as ServerHttp2Stream, restateStream)
      const restateServer: restate.RestateServer = restate.createServer()
        .bindService({
            descriptor: protoMetadata,
            service: "Greeter",
            instance: new GreeterService(),
          });

      const desm = new DurableExecutionStateMachine(connection, restateServer.methods["/dev.restate.Greeter/Greet"]);

      const inBytes = GreetRequest.encode(GreetRequest.create({ name: "bob" })).finish();

      desm.onIncomingMessage(START_MESSAGE_TYPE, 
        StartMessage.create({ invocationId: Buffer.from("abcd"), knownEntries: 1 }));

      desm.onIncomingMessage(POLL_INPUT_STREAM_ENTRY_MESSAGE_TYPE, PollInputStreamEntryMessage.create({
          value: Buffer.from(inBytes)
        }));

      connection.end();

      
      const result: Array<any> = await connection.getResult();
      const response = GreetResponse.decode(result[0].message.value);

      console.log(GreetResponse.decode(result[0].message.value));

      expect(response).toStrictEqual(GreetResponse.create({greeting: "Hello bob"}))
  
    });
  });

  describe("Greeter/MultiWord", () => {
    it("should call multiword and return a GetStateEntryMessage", async () => {
      const http2stream = mockHttp2DuplexStream();
      const restateStream = RestateDuplexStream.from(http2stream);
      const connection = new TestConnection(http2stream as ServerHttp2Stream, restateStream)
      const restateServer: restate.RestateServer = restate.createServer()
        .bindService({
            descriptor: protoMetadata,
            service: "Greeter",
            instance: new GreeterService(),
          });

      const desm = new DurableExecutionStateMachine(connection, restateServer.methods["/dev.restate.Greeter/MultiWord"]);

      const inBytes = GreetRequest.encode(GreetRequest.create({ name: "bob" })).finish();

      desm.onIncomingMessage(START_MESSAGE_TYPE, 
        StartMessage.create({
          invocationId: Buffer.from("abcd"),
          knownEntries: 1,
        }));

      desm.onIncomingMessage(POLL_INPUT_STREAM_ENTRY_MESSAGE_TYPE, PollInputStreamEntryMessage.create({
          value: Buffer.from(inBytes)
        }));

      connection.end();

      const result: Array<any> = await connection.getResult();

      expect(result[0].message_type).toStrictEqual(GET_STATE_ENTRY_MESSAGE_TYPE);
      expect(result[0].message.key.toString()).toStrictEqual("seen");


    });
  });

  describe("Greeter/MultiWord2", () => {
    it("should call multiword and have a completed get state message", async () => {
      const http2stream = mockHttp2DuplexStream();
      const restateStream = RestateDuplexStream.from(http2stream);
      const connection = new TestConnection(http2stream as ServerHttp2Stream, restateStream)
      const restateServer: restate.RestateServer = restate.createServer()
        .bindService({
            descriptor: protoMetadata,
            service: "Greeter",
            instance: new GreeterService(),
          });

      const desm = new DurableExecutionStateMachine(connection, restateServer.methods["/dev.restate.Greeter/MultiWord"]);

      const inBytes = GreetRequest.encode(GreetRequest.create({ name: "bob" })).finish();

      desm.onIncomingMessage(START_MESSAGE_TYPE, 
        StartMessage.create({
          invocationId: Buffer.from("abcd"),
          knownEntries: 2,
        }));

      desm.onIncomingMessage(POLL_INPUT_STREAM_ENTRY_MESSAGE_TYPE, PollInputStreamEntryMessage.create({
          value: Buffer.from(inBytes)
        }));

      desm.onIncomingMessage(GET_STATE_ENTRY_MESSAGE_TYPE, GetStateEntryMessage.create({
        key: Buffer.from("seen"),
        value: Buffer.from("5")
      }));

      connection.end();

      const result: Array<any> = await connection.getResult();


      expect(result[0].message_type).toStrictEqual(SET_STATE_ENTRY_MESSAGE_TYPE);
      expect(result[0].message.key.toString()).toStrictEqual("seen");     
      // expect(result[0].message.value).c(Buffer.from("51");

    });
  });


  function mockHttp2DuplexStream() {
    return new stream.Duplex({
      write(chunk, _encoding, next) {
        this.push(chunk);
        next();
      },
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      read(_encoding) {
        // don't care.
      },
    });
  }
  