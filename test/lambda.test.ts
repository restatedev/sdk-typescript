/*
 * Copyright (c) 2023-2024 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

import { describe, expect } from "@jest/globals";
import * as restate from "../src/public_api";
import {
  protoMetadata,
  TestEmpty,
  TestGreeter,
  TestResponse,
} from "../src/generated/proto/test";
import { APIGatewayProxyEvent } from "aws-lambda";
import {
  ServiceDiscoveryRequest,
  ServiceDiscoveryResponse,
} from "../src/generated/proto/discovery";
import { encodeMessage } from "../src/io/encoder";
import { Message } from "../src/types/types";
import {
  awakeableMessage,
  END_MESSAGE,
  getStateMessage,
  greetRequest,
  greetResponse,
  inputMessage,
  outputMessage,
  startMessage,
} from "./protoutils";
import { decodeLambdaBody } from "../src/io/decoder";
import { Empty } from "../src/generated/google/protobuf/empty";

class LambdaGreeter implements TestGreeter {
  async greet(): Promise<TestResponse> {
    const ctx = restate.useKeyedContext(this);

    // state
    const state = (await ctx.get<string>("STATE")) || "nobody";

    return TestResponse.create({ greeting: `Hello ${state}` });
  }
}

describe("Lambda: decodeMessage", () => {
  it("returns a list of decoded messages", async () => {
    const messages: Message[] = [
      startMessage(2),
      inputMessage(greetRequest("Pete")),
      getStateMessage("STATE", "Foo"),
    ];
    const serializedMsgs = serializeMessages(messages);

    const decodedMessages = decodeLambdaBody(serializedMsgs);

    expect(decodedMessages).toStrictEqual(messages);
  });

  it("returns a list of decoded messages when last message body is empty", async () => {
    const messages: Message[] = [
      startMessage(2),
      inputMessage(
        TestEmpty.encode(
          TestEmpty.create({ greeting: Empty.create({}) })
        ).finish()
      ),
    ];
    const serializedMsgs = serializeMessages(messages);

    const decodedMessages = decodeLambdaBody(serializedMsgs);

    expect(decodedMessages).toStrictEqual(messages);
  });

  it("returns a list of decoded messages when last message body is empty", async () => {
    const messages: Message[] = [
      startMessage(2),
      inputMessage(greetRequest("Pete")),
      awakeableMessage(),
    ];
    const serializedMsgs = serializeMessages(messages);

    const decodedMessages = decodeLambdaBody(serializedMsgs);

    expect(decodedMessages).toStrictEqual(messages);
  });

  it("fails on an invalid input message with random signs at end of message", async () => {
    const messages: Message[] = [
      startMessage(2),
      inputMessage(greetRequest("Pete")),
      getStateMessage("STATE", "Fooo"),
    ];

    // appending random character to the base 64 encoded message
    const serializedMsgs = serializeMessages(messages) + "a";

    const decodedMessages = () => decodeLambdaBody(serializedMsgs);

    expect(decodedMessages).toThrow();
  });

  it("fails on an invalid input message with random signs in front of message", async () => {
    const messages: Message[] = [
      startMessage(2),
      inputMessage(greetRequest("Pete")),
      getStateMessage("STATE", "Fooo"),
    ];

    // appending random character to the base 64 encoded message
    const serializedMsgs = "a" + serializeMessages(messages);

    const decodedMessages = () => decodeLambdaBody(serializedMsgs);

    expect(decodedMessages).toThrow();
  });
});

describe("LambdaGreeter", () => {
  it("sends output response", async () => {
    const handler = getTestHandler();

    const request = apiProxyGatewayEvent(
      "/invoke/test.TestGreeter/Greet",
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
      END_MESSAGE,
    ]);
  });

  it("fails on query parameters in path", async () => {
    const handler = getTestHandler();

    const request = apiProxyGatewayEvent(
      "/invoke/test.TestGreeter/Greet?count=5",
      "application/restate",
      serializeMessages([startMessage(1), inputMessage(greetRequest("Pete"))])
    );
    const result = await handler(request);

    expect(result.statusCode).toStrictEqual(500);
    expect(result.headers).toStrictEqual({
      "content-type": "application/restate",
    });
    expect(result.isBase64Encoded).toStrictEqual(true);
    expect(Buffer.from(result.body, "base64").toString()).toContain(
      "" +
        "Invalid path: path URL seems to include query parameters: /invoke/test.TestGreeter/Greet?count=5"
    );
  });

  it("fails on invalid path", async () => {
    const handler = getTestHandler();

    const request = apiProxyGatewayEvent(
      "/invoke/test.TestGreeter",
      "application/restate",
      serializeMessages([startMessage(1), inputMessage(greetRequest("Pete"))])
    );
    const result = await handler(request);

    expect(result.statusCode).toStrictEqual(500);
    expect(result.headers).toStrictEqual({
      "content-type": "application/restate",
    });
    expect(result.isBase64Encoded).toStrictEqual(true);
    expect(Buffer.from(result.body, "base64").toString()).toContain(
      "Invalid path: path doesn't end in /invoke/SvcName/MethodName and also not in /discover: /invoke/test.TestGreeter"
    );
  });

  it("fails on invalid path no 'invoke' or 'discover'", async () => {
    const handler = getTestHandler();

    const request = apiProxyGatewayEvent(
      "/something/test.TestGreeter/Greet",
      "application/restate",
      serializeMessages([startMessage(1), inputMessage(greetRequest("Pete"))])
    );
    const result = await handler(request);

    expect(result.statusCode).toStrictEqual(500);
    expect(result.headers).toStrictEqual({
      "content-type": "application/restate",
    });
    expect(result.isBase64Encoded).toStrictEqual(true);
    expect(Buffer.from(result.body, "base64").toString()).toContain(
      "Invalid path: path doesn't end in /invoke/SvcName/MethodName and also not in /discover: /something/test.TestGreeter/Greet"
    );
  });

  it("fails on invalid path non-existing URL", async () => {
    const handler = getTestHandler();

    const request = apiProxyGatewayEvent(
      "/invoke/test.TestGreeter/Greets",
      "application/restate",
      serializeMessages([startMessage(1), inputMessage(greetRequest("Pete"))])
    );
    const result = await handler(request);

    expect(result.statusCode).toStrictEqual(404);
    expect(result.headers).toStrictEqual({
      "content-type": "application/restate",
    });
    expect(result.isBase64Encoded).toStrictEqual(true);
    expect(Buffer.from(result.body, "base64").toString()).toContain(
      "No service found for URL: /invoke/test.TestGreeter/Greets"
    );
  });

  it("handles discovery", async () => {
    const handler = getTestHandler();

    const discoverRequest = Buffer.from(
      ServiceDiscoveryRequest.encode(ServiceDiscoveryRequest.create()).finish()
    ).toString("base64");
    const request: APIGatewayProxyEvent = apiProxyGatewayEvent(
      "/discover",
      "application/proto",
      discoverRequest
    );

    const result = await handler(request);

    expect(result.statusCode).toStrictEqual(200);
    expect(result.headers).toStrictEqual({
      "content-type": "application/proto",
    });
    expect(result.isBase64Encoded).toStrictEqual(true);

    const decodedResponse = ServiceDiscoveryResponse.decode(
      Buffer.from(result.body, "base64")
    );

    expect(decodedResponse.services).toContain("test.TestGreeter");
    expect(decodedResponse.files?.file.map((el) => el.name)).toEqual(
      expect.arrayContaining([
        "dev/restate/ext.proto",
        "google/protobuf/descriptor.proto",
        "proto/test.proto",
      ])
    );
  });
});

function getTestHandler() {
  return restate
    .createLambdaApiGatewayHandler()
    .bindService({
      descriptor: protoMetadata,
      service: "TestGreeter",
      instance: new LambdaGreeter(),
    })
    .handle();
}

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
    const msgBuf = encodeMessage(msg);

    buf = Buffer.concat([buf, msgBuf]);
  });

  return buf.toString("base64");
}

function deserializeMessages(body: string): Array<Message> {
  return decodeLambdaBody(body);
}
