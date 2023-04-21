import { describe, expect } from "@jest/globals";
import * as restate from "../src/public_api";
import {
  protoMetadata,
  TestGreeter,
  TestRequest,
  TestResponse,
} from "../src/generated/proto/test";
import { APIGatewayProxyEvent } from "aws-lambda";
import { ServiceDiscoveryRequest } from "../src/generated/proto/discovery";
import { encodeMessage } from "../src/protocol_stream";
import { Message } from "../src/types";
import {
  getStateMessage,
  greetRequest,
  greetResponse,
  inputMessage,
  outputMessage,
  startMessage,
  suspensionMessage,
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

describe("LambdaGreeter: Invoke Lambda function - getState", () => {
  it("should call greet", async () => {
    const handler = restate.lambdaHandler().bindService({
      descriptor: protoMetadata,
      service: "TestGreeter",
      instance: new LambdaGreeter(),
    }).create();

    const request = apiProxyGatewayEvent(
      "/invoke/dev.restate.TestGreeter/Greet",
      serializeMessages([
        startMessage(1),
        inputMessage(
          TestRequest.encode(TestRequest.create({ name: "Pete" })).finish()
        ),
      ])
    );
    console.log(JSON.stringify(request));
    const result = await handler(request);

    expect(result.statusCode).toStrictEqual(200);
    expect(result.isBase64Encoded).toStrictEqual(true);
    expect(deserializeMessages(result.body)).toStrictEqual([
      getStateMessage("STATE"),
      suspensionMessage([1]),
    ]);
  });
});

describe("LambdaGreeter: Invoke Lambda function - output message response", () => {
  it("should call greet", async () => {
    const handler = restate.lambdaHandler().bindService({
      descriptor: protoMetadata,
      service: "TestGreeter",
      instance: new LambdaGreeter(),
    }).create();

    const request = apiProxyGatewayEvent(
      "/invoke/dev.restate.TestGreeter/Greet",
      serializeMessages([
        startMessage(2),
        inputMessage(greetRequest("Pete")),
        getStateMessage("STATE", "Foo"),
      ])
    );
    const result = await handler(request);

    expect(result.statusCode).toStrictEqual(200);
    expect(result.isBase64Encoded).toStrictEqual(true);
    expect(deserializeMessages(result.body)).toStrictEqual([
      outputMessage(greetResponse("Hello Foo")),
    ]);
  });
});

describe("LambdaGreeter: discovery of Lambda function", () => {
  it("should call greet", async () => {
    const handler = restate.lambdaHandler().bindService({
      descriptor: protoMetadata,
      service: "TestGreeter",
      instance: new LambdaGreeter(),
    }).create();

    const request: APIGatewayProxyEvent = {
      resource: "",
      stageVariables: null,
      body: Buffer.from(
        ServiceDiscoveryRequest.encode(
          ServiceDiscoveryRequest.create()
        ).finish()
      ).toString("base64"),
      httpMethod: "POST",
      headers: { "content-type": "application/proto" },
      queryStringParameters: {},
      pathParameters: {},
      requestContext: {} as any,
      multiValueHeaders: {},
      multiValueQueryStringParameters: {},
      path: "/discover",
      isBase64Encoded: true,
    };

    const result = await handler(request);

    console.log(result);
  });
});

function apiProxyGatewayEvent(
  invokePath: string,
  messagesBase64: string
): APIGatewayProxyEvent {
  return {
    resource: "",
    stageVariables: null,
    body: messagesBase64,
    httpMethod: "POST",
    headers: { "content-type": "application/restate" },
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
  return LambdaConnection.decodeMessage(Buffer.from(body, "base64")).map(
    (entry) => new Message(entry.header.messageType, entry.message)
  );
}
