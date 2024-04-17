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
import { APIGatewayProxyEvent } from "aws-lambda";
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
import { TestGreeter, TestResponse } from "./testdriver";
import { ComponentType, Deployment } from "../src/types/discovery";
import { X_RESTATE_SERVER } from "../src/user_agent";

class LambdaGreeter implements TestGreeter {
  async greet(
    ctx: restate.ObjectContext
    /*req: TestRequest */
  ): Promise<TestResponse> {
    // state
    const state = (await ctx.get<string>("STATE")) || "nobody";

    return TestResponse.create({ greeting: `Hello ${state}` });
  }
}

describe("Lambda: decodeMessage", () => {
  it("returns a list of decoded messages", async () => {
    const messages: Message[] = [
      startMessage({ knownEntries: 2 }),
      inputMessage(greetRequest("Pete")),
      getStateMessage("STATE", "Foo"),
    ];
    const serializedMsgs = serializeMessages(messages);

    const decodedMessages = decodeLambdaBody(serializedMsgs);

    expect(decodedMessages).toStrictEqual(messages);
  });

  it("returns a list of decoded messages when last message body is empty", async () => {
    const messages: Message[] = [
      startMessage({ knownEntries: 2 }),
      inputMessage(new Uint8Array()),
    ];
    const serializedMsgs = serializeMessages(messages);

    const decodedMessages = decodeLambdaBody(serializedMsgs);

    expect(decodedMessages).toStrictEqual(messages);
  });

  it("should returns a list of decoded messages when last message body is empty", async () => {
    const messages: Message[] = [
      startMessage({ knownEntries: 2 }),
      inputMessage(greetRequest("Pete")),
      awakeableMessage(),
    ];
    const serializedMsgs = serializeMessages(messages);

    const decodedMessages = decodeLambdaBody(serializedMsgs);

    expect(decodedMessages).toStrictEqual(messages);
  });

  it("fails on an invalid input message with random signs at end of message", async () => {
    const messages: Message[] = [
      startMessage({ knownEntries: 2 }),
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
      startMessage({ knownEntries: 2 }),
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
      "/invoke/greeter/greet",
      "application/restate",
      serializeMessages([
        startMessage({ knownEntries: 2, key: "Pete" }),
        inputMessage(greetRequest("Pete")),
        getStateMessage("STATE", "Foo"),
      ])
    );
    const result = await handler(request, {});

    expect(result.statusCode).toStrictEqual(200);
    expect(result.headers).toStrictEqual({
      "content-type": "application/restate",
      "x-restate-server": X_RESTATE_SERVER,
    });
    expect(result.isBase64Encoded).toStrictEqual(true);
    expect(deserializeMessages(result.body)).toStrictEqual([
      outputMessage(greetResponse("Hello Foo")),
      END_MESSAGE,
    ]);
  });

  it("fails on invalid path", async () => {
    const handler = getTestHandler();

    const request = apiProxyGatewayEvent(
      "/invoke/greeter",
      "application/restate",
      serializeMessages([
        startMessage({ knownEntries: 1 }),
        inputMessage(greetRequest("Pete")),
      ])
    );
    const result = await handler(request, {});

    expect(result.statusCode).toStrictEqual(404);
    expect(result.headers).toStrictEqual({
      "content-type": "application/restate",
      "x-restate-server": X_RESTATE_SERVER,
    });
    expect(result.isBase64Encoded).toStrictEqual(true);
  });

  it("fails on invalid path no 'invoke' or 'discover'", async () => {
    const handler = getTestHandler();

    const request = apiProxyGatewayEvent(
      "/something/greeter/greet",
      "application/restate",
      serializeMessages([
        startMessage({ knownEntries: 1 }),
        inputMessage(greetRequest("Pete")),
      ])
    );
    const result = await handler(request, {});

    expect(result.statusCode).toStrictEqual(404);
    expect(result.headers).toStrictEqual({
      "content-type": "application/restate",
      "x-restate-server": X_RESTATE_SERVER,
    });
  });

  it("fails on invalid path non-existing URL", async () => {
    const handler = getTestHandler();

    const request = apiProxyGatewayEvent(
      "/invoke/greeter/greets",
      "application/restate",
      serializeMessages([
        startMessage({ knownEntries: 1 }),
        inputMessage(greetRequest("Pete")),
      ])
    );
    const result = await handler(request, {});

    expect(result.statusCode).toStrictEqual(404);
    expect(result.headers).toStrictEqual({
      "content-type": "application/restate",
      "x-restate-server": X_RESTATE_SERVER,
    });
  });

  it("handles discovery", async () => {
    const handler = getTestHandler();

    const request: APIGatewayProxyEvent = apiProxyGatewayEvent(
      "/discover",
      "application/json",
      Buffer.alloc(0).toString("base64")
    );

    const result = await handler(request, {});

    expect(result.statusCode).toStrictEqual(200);
    expect(result.headers).toStrictEqual({
      "content-type": "application/json",
      "x-restate-server": X_RESTATE_SERVER,
    });
    expect(result.isBase64Encoded).toStrictEqual(true);

    const decodedResponse: Deployment = JSON.parse(
      Buffer.from(result.body, "base64").toString("utf8")
    );
    expect(
      decodedResponse.components[0].fullyQualifiedComponentName
    ).toStrictEqual("greeter");
    expect(decodedResponse.components[0].componentType).toEqual(
      ComponentType.VIRTUAL_OBJECT
    );
  });
});

function getTestHandler() {
  return restate
    .endpoint()
    .bind(
      restate.object({
        name: "greeter",
        handlers: {
          // eslint-disable @typescript-eslint/no-unused-vars
          greet: (ctx: restate.ObjectContext) =>
            new LambdaGreeter().greet(ctx /*req*/),
        },
      })
    )
    .lambdaHandler();
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
