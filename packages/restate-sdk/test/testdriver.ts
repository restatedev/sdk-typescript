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

import {
  COMPLETION_MESSAGE_TYPE,
  ENTRY_ACK_MESSAGE_TYPE,
  START_MESSAGE_TYPE,
  StartMessage,
} from "../src/types/protocol";
import { Connection } from "../src/connection/connection";
import { formatMessageAsJson } from "../src/utils/utils";
import { Message } from "../src/types/types";
import { rlog } from "../src/logger";
import { StateMachine } from "../src/state_machine";
import { InvocationBuilder } from "../src/invocation";
import { EndpointImpl } from "../src/endpoint/endpoint_impl";
import { ObjectContext } from "../src/context";
import { ServiceDefinition, object } from "../src/public_api";
import { ProtocolMode } from "../src/types/discovery";

export type TestRequest = {
  name: string;
};

export type TestResponse = {
  greeting: string;
};

export const TestResponse = {
  create: (test: TestResponse): TestResponse => test,
};

export type GreetType = {
  greet: (key: string, arg: TestRequest) => Promise<TestResponse>;
};

export const GreeterApi: ServiceDefinition<"greeter", GreetType> = {
  name: "greeter",
};

export interface TestGreeter {
  greet(ctx: ObjectContext, message: TestRequest): Promise<TestResponse>;
}

export class TestDriver implements Connection {
  private readonly result: Message[] = [];

  private restateServer: TestRestateServer;
  private stateMachine: StateMachine;
  private completionMessages: Message[];

  constructor(
    instance: TestGreeter,
    entries: Message[],
    private readonly protocolMode: ProtocolMode = ProtocolMode.BIDI_STREAM
  ) {
    this.restateServer = new TestRestateServer();

    const svc = object({
      name: "greeter",
      handlers: {
        greet: async (ctx: ObjectContext, arg: TestRequest) => {
          return instance.greet(ctx, arg);
        },
      },
    });

    this.restateServer.bind(svc);

    if (entries.length < 2) {
      throw new Error(
        "Less than two runtime messages supplied for test. Need to have at least start message and input message."
      );
    }

    if (entries[0].messageType !== START_MESSAGE_TYPE) {
      throw new Error("First message has to be start message.");
    }

    // Get the index of where the completion messages start in the entries list
    const firstCompletionIndex = entries.findIndex(
      (value) =>
        value.messageType === COMPLETION_MESSAGE_TYPE ||
        value.messageType === ENTRY_ACK_MESSAGE_TYPE
    );

    // The last message of the replay is the one right before the first completion
    const endOfReplay =
      firstCompletionIndex !== -1 ? firstCompletionIndex : entries.length;

    const msg = entries[0];
    // We need to set the right number for known entries. Copy the rest
    const startEntry = msg.message as StartMessage;
    entries[0] = new Message(
      msg.messageType,
      new StartMessage({
        id: startEntry.id,
        debugId: startEntry.debugId,
        knownEntries: endOfReplay - 1,
        stateMap: startEntry.stateMap,
        partialState: startEntry.partialState,
        key: startEntry.key,
      }),
      msg.completed,
      msg.protocolVersion,
      msg.requiresAck
    );

    const replayMessages = entries.slice(0, endOfReplay);
    this.completionMessages = entries.slice(endOfReplay);

    if (
      replayMessages.filter(
        (value) =>
          value.messageType === COMPLETION_MESSAGE_TYPE ||
          value.messageType === ENTRY_ACK_MESSAGE_TYPE
      ).length > 0
    ) {
      throw new Error(
        "You cannot interleave replay messages with completion or ack messages. First define the replay messages, then the completion messages."
      );
    }

    if (
      this.completionMessages.filter(
        (value) =>
          value.messageType !== COMPLETION_MESSAGE_TYPE &&
          value.messageType !== ENTRY_ACK_MESSAGE_TYPE
      ).length > 0
    ) {
      throw new Error(
        "You cannot interleave replay messages with completion or ack messages. First define the replay messages, then the completion messages."
      );
    }

    const method = this.restateServer
      .componentByName("greeter")
      ?.handlerMatching({
        componentName: "greeter",
        handlerName: "greet",
      });

    if (!method) {
      throw new Error("Something is wrong with the test setup");
    }

    const invocationBuilder = new InvocationBuilder(method);
    replayMessages.forEach((el) => invocationBuilder.handleMessage(el));
    const invocation = invocationBuilder.build();

    this.stateMachine = new StateMachine(
      this,
      invocation,
      this.protocolMode,
      true,
      invocation.inferLoggerContext()
    );
  }

  async run(): Promise<Message[]> {
    const completed = this.stateMachine.invoke();

    // we send the completions here. Because we don't await the messages that we send the completions for,
    // we enqueue those completions in the event loop, so they get processed when everything else is done.
    // This is highly fragile!!!
    this.completionMessages.forEach((el) => {
      setTimeout(() => this.stateMachine.handleMessage(el));
    });
    // Set the input channel to closed a bit after sending the messages
    // to make the service finish up the work it can do and suspend or send back a response.
    setTimeout(() => this.stateMachine.handleInputClosed());

    await completed;

    return Promise.resolve(this.result);
  }

  send(msg: Message): Promise<void> {
    this.result.push(msg);
    rlog.debug(
      `Adding result to the result array. Message type: ${
        msg.messageType
      }, message: 
        ${
          msg.message instanceof Uint8Array
            ? (msg.message as Uint8Array).toString()
            : formatMessageAsJson(msg.message)
        }`
    );
    return Promise.resolve();
  }

  onClose() {
    // nothing to do
  }

  async end(): Promise<void> {
    // nothing to do
    return Promise.resolve();
  }

  onError() {
    // nothing to do
  }
}

/**
 * This class' only purpose is to make certain methods accessible in tests.
 * Those methods are otherwise protected, to reduce the public interface and
 * make it simpler for users to understand what methods are relevant for them,
 * and which ones are not.
 */
class TestRestateServer extends EndpointImpl {}
