import { describe, expect } from "@jest/globals";
import * as restate from "../src/public_api";
import {
  protoMetadata,
  TestGreeter,
  TestRequest,
  TestResponse,
} from "../src/generated/proto/test";
import { APIGatewayProxyEvent } from "aws-lambda";
import {
  ServiceDiscoveryRequest,
  ServiceDiscoveryResponse,
} from "../src/generated/proto/discovery";
import { encodeMessage } from "../src/protocol_stream";
import { Message } from "../src/types";
import {
  getStateMessage,
  greetRequest,
  greetResponse,
  inputMessage,
  outputMessage,
  startMessage,
} from "./protoutils";
import { LambdaConnection } from "../src/lambda_connection";

class LambdaGreeter implements TestGreeter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    // state
    const state = (await ctx.get<string>("STATE")) || "nobody";
    console.log("Current state is " + state);

    return TestResponse.create({ greeting: `Hello ${state}` });
  }
}

describe("Lambda: decodeMessage", () => {
  it("should return a list of decoded messages", async () => {
    const messages: Message[] = [
      startMessage(2),
      inputMessage(greetRequest("Pete")),
      getStateMessage("STATE", "Foo"),
    ];
    const serializedMsgs = serializeMessages(messages);

    const decodedMessages = LambdaConnection.decodeMessage(serializedMsgs);

    expect(
      decodedMessages.map(
        (entry) => new Message(entry.header.messageType, entry.message)
      )
    ).toStrictEqual(messages);
  });
});

describe("Lambda: decodeMessage", () => {
  it("should fail on an invalid input message with random signs at end of message", async () => {
    const messages: Message[] = [
      startMessage(2),
      inputMessage(greetRequest("Pete")),
      getStateMessage("STATE", "Fooo"),
    ];

    // appending random character to the base 64 encoded message
    const serializedMsgs = serializeMessages(messages) + "a";

    const decodedMessages = () =>
      LambdaConnection.decodeMessage(serializedMsgs);

    expect(decodedMessages).toThrow(
      "Parsing error: SDK cannot parse the message. Message was not valid base64 encoded."
    );
  });
});

describe("Lambda: decodeMessage", () => {
  it("should fail on an invalid input message with random signs in front of message", async () => {
    const messages: Message[] = [
      startMessage(2),
      inputMessage(greetRequest("Pete")),
      getStateMessage("STATE", "Fooo"),
    ];

    // appending random character to the base 64 encoded message
    const serializedMsgs = "a" + serializeMessages(messages);

    const decodedMessages = () =>
      LambdaConnection.decodeMessage(serializedMsgs);

    expect(decodedMessages).toThrow(
      "Parsing error: SDK cannot parse the message. Message was not valid base64 encoded."
    );
  });
});

describe("LambdaGreeter: Invoke Lambda function - output message response", () => {
  it("should call greet", async () => {
    const handler = restate
      .lambdaHandler()
      .bindService({
        descriptor: protoMetadata,
        service: "TestGreeter",
        instance: new LambdaGreeter(),
      })
      .create();

    const request = apiProxyGatewayEvent(
      "/invoke/dev.restate.TestGreeter/Greet",
      "application/restate",
      serializeMessages([
        startMessage(2),
        inputMessage(greetRequest("Pete")),
        getStateMessage("STATE", "Foo"),
      ])
    );
    const result = await handler(request);

    expect(result.statusCode).toStrictEqual(200);
    expect(result.headers).toStrictEqual({
      "content-type": "application/restate",
    });
    expect(result.isBase64Encoded).toStrictEqual(true);
    expect(deserializeMessages(result.body)).toStrictEqual([
      outputMessage(greetResponse("Hello Foo")),
    ]);
  });
});

describe("LambdaGreeter: discovery of Lambda function", () => {
  it("should call greet", async () => {
    const handler = restate
      .lambdaHandler()
      .bindService({
        descriptor: protoMetadata,
        service: "TestGreeter",
        instance: new LambdaGreeter(),
      })
      .create();

    const discoverRequest = Buffer.from(
      ServiceDiscoveryRequest.encode(ServiceDiscoveryRequest.create()).finish()
    ).toString("base64");
    const request: APIGatewayProxyEvent = apiProxyGatewayEvent(
      "/discover",
      "application/proto",
      discoverRequest
    );

    const result = await handler(request);

    console.log(result);

    expect(result.statusCode).toStrictEqual(200);
    expect(result.headers).toStrictEqual({
      "content-type": "application/proto",
    });
    expect(result.isBase64Encoded).toStrictEqual(true);

    const decodedResponse = ServiceDiscoveryResponse.decode(
      Buffer.from(result.body, "base64")
    );

    expect(decodedResponse.services).toContain("dev.restate.TestGreeter");
    expect(decodedResponse.files?.file.map((el) => el.name)).toEqual(
      expect.arrayContaining([
        "proto/ext.proto",
        "google/protobuf/descriptor.proto",
        "proto/test.proto",
      ])
    );
  });
});

function apiProxyGatewayEvent(
  invokePath: string,
  contentType: string,
  messagesBase64: string
): APIGatewayProxyEvent {
  return {
    resource: "",
    stageVariables: null,
    body: messagesBase64,
    httpMethod: "POST",
    headers: { "content-type": contentType },
    queryStringParameters: {},
    pathParameters: {},
    requestContext: {} as never,
    multiValueHeaders: {},
    multiValueQueryStringParameters: {},
    path: invokePath,
    isBase64Encoded: true,
  };
}

function serializeMessages(messages: Message[]): string {
  let buf = Buffer.alloc(0);

  messages.forEach((msg: Message) => {
    const msgBuf = encodeMessage({
      messageType: msg.messageType,
      message: msg.message,
      completed: msg.completed,
      requiresAck: msg.requiresAck,
    });

    buf = Buffer.concat([buf, msgBuf]);
  });

  return buf.toString("base64");
}

function deserializeMessages(body: string): Array<Message> {
  return LambdaConnection.decodeMessage(body).map(
    (entry) => new Message(entry.header.messageType, entry.message)
  );
}
