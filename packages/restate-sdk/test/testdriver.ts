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
} from "../src/types/protocol.js";
import type { Connection } from "../src/connection/connection.js";
import { Message } from "../src/types/types.js";
import { StateMachine } from "../src/state_machine.js";
import { InvocationBuilder } from "../src/invocation.js";
import type { ObjectContext } from "../src/context.js";
import type {
  ServiceDefinition,
  VirtualObjectDefinition,
  WorkflowDefinition,
} from "../src/public_api.js";
import { object } from "../src/public_api.js";
import { NodeEndpoint } from "../src/endpoint/node_endpoint.js";
import type { EndpointBuilder } from "../src/endpoint/endpoint_builder.js";

export type TestRequest = {
  name: string;
};

export type TestResponse = {
  greeting: string;
};

export const TestResponse = {
  create: (test: TestResponse): TestResponse => test,
};

export const GreeterApi: VirtualObjectDefinition<"greeter", TestGreeter> = {
  name: "greeter",
};

export interface TestGreeter {
  greet(ctx: ObjectContext, message: TestRequest): Promise<TestResponse>;
}

export class TestDriver {
  private readonly uut: UUT<string, unknown>;
  private readonly input: Message[];

  // Deprecated, please use testService below
  constructor(instance: TestGreeter, entries: Message[]) {
    this.uut = testService(
      object({
        name: "greeter",
        handlers: {
          greet: async (ctx: ObjectContext, arg: TestRequest) => {
            return instance.greet(ctx, arg);
          },
        },
      })
    );
    this.input = entries;
  }

  async run(): Promise<Message[]> {
    return await this.uut.run({
      input: this.input,
    });
  }
}

/**
 * This class' only purpose is to make certain methods accessible in tests.
 * Those methods are otherwise protected, to reduce the public interface and
 * make it simpler for users to understand what methods are relevant for them,
 * and which ones are not.
 */
class TestRestateServer extends NodeEndpoint {}

interface RunOptions {
  /// If not provided, will call the first service
  service?: string;
  /// If not provided, will call the first handler
  handler?: string;
  input: Message[];
}

export class UUT<N extends string, T> {
  private readonly defaultService: string;
  private readonly defaultHandler: string;

  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  constructor(
    private readonly definition:
      | ServiceDefinition<N, T>
      | VirtualObjectDefinition<N, T>
      | WorkflowDefinition<N, T>
  ) {
    // Infer service name and handler
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-unsafe-assignment
    this.defaultService = definition.name;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const definitionRecord: Record<string, never> =
      definition as unknown as Record<string, never>;
    if (definitionRecord && definitionRecord.service != undefined) {
      this.defaultHandler = Object.keys(
        definitionRecord.service as { [s: string]: unknown }
      )[0];
    } else if (definitionRecord && definitionRecord.object != undefined) {
      this.defaultHandler = Object.keys(
        definitionRecord.object as { [s: string]: unknown }
      )[0];
    } else if (definitionRecord && definitionRecord.workflow != undefined) {
      this.defaultHandler = Object.keys(
        definitionRecord.workflow as { [s: string]: unknown }
      )[0];
    } else {
      throw new TypeError(
        "supports only a service or a virtual object or a workflow definition"
      );
    }
  }

  public async run(options: RunOptions): Promise<Message[]> {
    const restateServer = new TestRestateServer();
    restateServer.bind(this.definition);

    // Sanity check on input messages
    if (options.input.length < 2) {
      throw new Error(
        "Less than two runtime messages supplied for test. Need to have at least start message and input message."
      );
    }
    if (options.input[0].messageType !== START_MESSAGE_TYPE) {
      throw new Error("First message has to be start message.");
    }

    // Get the index of where the completion messages start in the entries list
    const firstCompletionIndex = options.input.findIndex(
      (value) =>
        value.messageType === COMPLETION_MESSAGE_TYPE ||
        value.messageType === ENTRY_ACK_MESSAGE_TYPE
    );

    // The last message of the replay is the one right before the first completion
    const endOfReplay =
      firstCompletionIndex !== -1 ? firstCompletionIndex : options.input.length;

    // --- Patch StartMessage with the right number of entries
    const startMsg = options.input[0];
    const startEntry = startMsg.message as StartMessage;
    options.input[0] = new Message(
      startMsg.messageType,
      new StartMessage({
        id: startEntry.id,
        debugId: startEntry.debugId,
        knownEntries: endOfReplay - 1,
        stateMap: startEntry.stateMap,
        partialState: startEntry.partialState,
        key: startEntry.key,
      }),
      startMsg.completed,
      startMsg.requiresAck
    );

    // TODO the production code here is doing some bad assumption,
    //  by assuming that during the initial replay phase no CompletionMessages are sent.
    //  Although this is currently correct, it is correct only due to how the runtime is implemented,
    //  and might not be generally true if we change the runtime.
    //  This should probably be fixed in the production code, and subsequently the test should
    //  stop splitting the input messages here.
    const replayMessages = options.input.slice(0, endOfReplay);
    const completionMessages = options.input.slice(endOfReplay);
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
      completionMessages.filter(
        (value) =>
          value.messageType !== COMPLETION_MESSAGE_TYPE &&
          value.messageType !== ENTRY_ACK_MESSAGE_TYPE
      ).length > 0
    ) {
      throw new Error(
        "You cannot interleave replay messages with completion or ack messages. First define the replay messages, then the completion messages."
      );
    }

    const method = restateServer
      .componentByName(options.service ? options.service : this.defaultService)
      ?.handlerMatching({
        componentName: options.service ? options.service : this.defaultService,
        handlerName: options.handler ? options.handler : this.defaultHandler,
      });
    if (!method) {
      throw new Error("Can't find the handler to execute");
    }

    const invocationBuilder = new InvocationBuilder(method);
    replayMessages.forEach((el) => invocationBuilder.handleMessage(el));
    const invocation = invocationBuilder.build();

    const testConnection = new TestConnection();
    const stateMachine = new StateMachine(
      testConnection,
      invocation,
      method.kind(),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      (restateServer as unknown as { builder: EndpointBuilder }).builder.logger,
      invocation.inferLoggerContext()
    );

    const completed = stateMachine.invoke();

    // we send the completions here. Because we don't await the messages that we send the completions for,
    // we enqueue those completions in the event loop, so they get processed when everything else is done.
    // This is highly fragile!!!
    completionMessages.forEach((el) => {
      setTimeout(() => stateMachine.handleMessage(el));
    });
    // Set the input channel to closed a bit after sending the messages
    // to make the service finish up the work it can do and suspend or send back a response.
    setTimeout(() => stateMachine.handleInputClosed());

    await completed;

    return Promise.resolve(testConnection.sentMessages());
  }
}

// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
export function testService<N extends string, T>(
  definition:
    | ServiceDefinition<N, T>
    | VirtualObjectDefinition<N, T>
    | WorkflowDefinition<N, T>
): UUT<N, T> {
  return new UUT<N, T>(definition);
}

class TestConnection implements Connection {
  private result: Message[] = [];

  headers(): ReadonlyMap<string, string | string[] | undefined> {
    return new Map();
  }

  send(msg: Message): Promise<void> {
    this.result.push(msg);
    return Promise.resolve();
  }

  async end(): Promise<void> {
    // nothing to do
    return Promise.resolve();
  }

  sentMessages(): Message[] {
    return this.result;
  }
}
