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
import { TestDriver, TestGreeter, TestResponse } from "./testdriver";
import {
  END_MESSAGE,
  failure,
  failureWithTerminal,
  errorMessage,
  greetRequest,
  inputMessage,
  outputMessage,
  sideEffectMessage,
  startMessage,
  suspensionMessage,
  greetResponse,
} from "./protoutils";
import { ObjectContext } from "../src/context";
import { TerminalError } from "../src/public_api";

class GreeterNoThrows implements TestGreeter {
  async greet(ctx: ObjectContext): Promise<TestResponse> {
    return await ctx.sideEffect(async () =>
      TestResponse.create({ greeting: `Hello` })
    );
  }
}

class GreeterThrowsTerm implements TestGreeter {
  async greet(ctx: ObjectContext): Promise<TestResponse> {
    return await ctx.sideEffect(async () => {
      throw new TerminalError("oh no");
    });
  }
}

class GreeterThrowsRecoverable implements TestGreeter {
  async greet(ctx: ObjectContext): Promise<TestResponse> {
    return await ctx.sideEffect(async () => {
      throw new TypeError("oh no");
    });
  }
}

class GreeterTriesToCatchNonTerminal implements TestGreeter {
  async greet(ctx: ObjectContext): Promise<TestResponse> {
    try {
      const result = await ctx.sideEffect(async () => {
        throw new TypeError("oh no");
      });
      return result;
    } catch (e) {
      ctx.set("foo", "bar");
      return TestResponse.create({ greeting: "bye" });
    }
  }
}

describe("Greeter", () => {
  it("That does not throw any exception is added to the journal", async () => {
    const result = await new TestDriver(new GreeterNoThrows(), [
      startMessage({ knownEntries: 1, key: "Pete" }),
      inputMessage(greetRequest("Pete")),
    ]).run();

    expect(result).toStrictEqual([
      sideEffectMessage({ greeting: "Hello" }),
      suspensionMessage([1]),
    ]);
  });

  it("That does not throw any exception completes successfully", async () => {
    const result = await new TestDriver(new GreeterNoThrows(), [
      startMessage({ knownEntries: 2, key: "Pete" }),
      inputMessage(greetRequest("Pete")),
      sideEffectMessage({ greeting: "Hello" }),
    ]).run();

    expect(result).toStrictEqual([
      outputMessage(greetResponse("Hello")),
      END_MESSAGE,
    ]);
  });

  it("A terminal exception thrown is added to the journal", async () => {
    const result = await new TestDriver(new GreeterThrowsTerm(), [
      startMessage({ knownEntries: 1, key: "Pete" }),
      inputMessage(greetRequest("Pete")),
    ]).run();

    const failure = failureWithTerminal(true, "oh no");

    expect(result).toStrictEqual([
      sideEffectMessage(undefined, failure),
      suspensionMessage([1]),
    ]);
  });

  it("After a terminal exception is acknowledge, the execution ends", async () => {
    const failure = failureWithTerminal(true, "oh no");

    const result = await new TestDriver(new GreeterThrowsTerm(), [
      startMessage({ knownEntries: 3, key: "Pete" }),
      inputMessage(greetRequest("Pete")),
      sideEffectMessage(undefined, failure),
    ]).run();

    expect(result).toStrictEqual([
      outputMessage(undefined, failure.failure),
      END_MESSAGE,
    ]);
  });

  it("A non terminal exception (1) does not record the sideEffect in the journal. (2) ends the current attempt", async () => {
    const result = await new TestDriver(new GreeterThrowsRecoverable(), [
      startMessage({ knownEntries: 1, key: "Pete" }),
      inputMessage(greetRequest("Pete")),
    ]).run();

    const f = failure("oh no");

    expect(result).toStrictEqual([errorMessage(f)]);
  });

  it("Local recovery from a non terminal exception, has no effect.", async () => {
    const result = await new TestDriver(new GreeterTriesToCatchNonTerminal(), [
      startMessage({ knownEntries: 1, key: "Pete" }),
      inputMessage(greetRequest("Pete")),
    ]).run();

    const f = failure("oh no");

    expect(result).toStrictEqual([errorMessage(f)]);
  });
});
