/*
 * Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

import { TestGreeter, TestResponse } from "../src/generated/proto/test";
import * as restate from "../src/public_api";
import {
  checkJournalMismatchError,
  resolveAwakeableMessage,
  getAwakeableId,
  greetRequest,
  greetResponse,
  inputMessage,
  invokeMessage,
  outputMessage,
  startMessage,
  rejectAwakeableMessage,
} from "./protoutils";
import { describe, expect } from "@jest/globals";
import { TestDriver } from "./testdriver";

class ResolveAwakeableGreeter implements TestGreeter {
  constructor(readonly payload: string) {}

  async greet(): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    const awakeableIdentifier = getAwakeableId(1);
    ctx.resolveAwakeable(awakeableIdentifier, this.payload);

    return TestResponse.create({ greeting: `Hello` });
  }
}

describe("ResolveAwakeableGreeter", () => {
  it("sends message to runtime", async () => {
    const result = await new TestDriver(new ResolveAwakeableGreeter("hello"), [
      startMessage(),
      inputMessage(greetRequest("Till")),
    ]).run();

    expect(result).toStrictEqual([
      resolveAwakeableMessage(
        "test.TestGreeter",
        Buffer.from("123"),
        Buffer.from("abcd"),
        1,
        "hello"
      ),
      outputMessage(greetResponse("Hello")),
    ]);
  });

  it("sends message to runtime for empty string", async () => {
    const result = await new TestDriver(new ResolveAwakeableGreeter(""), [
      startMessage(),
      inputMessage(greetRequest("Till")),
    ]).run();

    expect(result).toStrictEqual([
      resolveAwakeableMessage(
        "test.TestGreeter",
        Buffer.from("123"),
        Buffer.from("abcd"),
        1,
        ""
      ),
      outputMessage(greetResponse("Hello")),
    ]);
  });

  it("handles replay with value", async () => {
    const result = await new TestDriver(new ResolveAwakeableGreeter("hello"), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      resolveAwakeableMessage(
        "test.TestGreeter",
        Buffer.from("123"),
        Buffer.from("abcd"),
        1,
        "hello"
      ),
    ]).run();

    expect(result).toStrictEqual([outputMessage(greetResponse("Hello"))]);
  });

  it("handles replay with value empty string", async () => {
    const result = await new TestDriver(new ResolveAwakeableGreeter(""), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      resolveAwakeableMessage(
        "test.TestGreeter",
        Buffer.from("123"),
        Buffer.from("abcd"),
        1,
        ""
      ),
    ]).run();

    expect(result).toStrictEqual([outputMessage(greetResponse("Hello"))]);
  });

  it("fails on journal mismatch. Completed with invoke during replay.", async () => {
    const result = await new TestDriver(new ResolveAwakeableGreeter("hello"), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      invokeMessage(
        "test.TestGreeter",
        "Greet",
        greetRequest("Till"),
        greetResponse("TILL")
      ), // this should have been a completeawakeable
    ]).run();

    expect(result.length).toStrictEqual(1);
    checkJournalMismatchError(result[0]);
  });

  it("fails on journal mismatch. Completed with wrong service name", async () => {
    const result = await new TestDriver(new ResolveAwakeableGreeter("hello"), [
      startMessage(2),
      inputMessage(greetRequest("Till")),
      resolveAwakeableMessage(
        "TestGreeterzzz", // this should have been TestGreeter
        Buffer.from("123"),
        Buffer.from("abcd"),
        1,
        "hello"
      ),
    ]).run();

    expect(result.length).toStrictEqual(1);
    checkJournalMismatchError(result[0]);
  });

  it("fails on journal mismatch. Completed with wrong instance key.", async () => {
    const result = await new TestDriver(new ResolveAwakeableGreeter("hello"), [
      startMessage(2),
      inputMessage(greetRequest("Till")),
      resolveAwakeableMessage(
        "TestGreeter",
        Buffer.from("1234"), // this should have been a Buffer.from("123")
        Buffer.from("abcd"),
        1,
        "hello"
      ),
    ]).run();

    expect(result.length).toStrictEqual(1);
    checkJournalMismatchError(result[0]);
  });

  it("fails on journal mismatch. Completed with wrong invocation id.", async () => {
    const result = await new TestDriver(new ResolveAwakeableGreeter("hello"), [
      startMessage(2),
      inputMessage(greetRequest("Till")),
      resolveAwakeableMessage(
        "TestGreeter",
        Buffer.from("123"),
        Buffer.from("abcde"), // this should have been a Buffer.from("abcd")
        1,
        "hello"
      ),
    ]).run();

    expect(result.length).toStrictEqual(1);
    checkJournalMismatchError(result[0]);
  });

  it("fails on journal mismatch. Completed with wrong entry index.", async () => {
    const result = await new TestDriver(new ResolveAwakeableGreeter("hello"), [
      startMessage(2),
      inputMessage(greetRequest("Till")),
      resolveAwakeableMessage(
        "TestGreeter",
        Buffer.from("123"),
        Buffer.from("abcd"),
        2, // this should have been 1
        "hello"
      ),
    ]).run();

    expect(result.length).toStrictEqual(1);
    checkJournalMismatchError(result[0]);
  });
});

class RejectAwakeableGreeter implements TestGreeter {
  constructor(readonly reason: string) {}

  async greet(): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    const awakeableIdentifier = getAwakeableId(1);
    ctx.rejectAwakeable(awakeableIdentifier, this.reason);

    return TestResponse.create({ greeting: `Hello` });
  }
}

describe("RejectAwakeableGreeter", () => {
  it("sends message to runtime", async () => {
    const result = await new TestDriver(
      new RejectAwakeableGreeter("my bad error"),
      [startMessage(), inputMessage(greetRequest("Till"))]
    ).run();

    expect(result).toStrictEqual([
      rejectAwakeableMessage(
        "test.TestGreeter",
        Buffer.from("123"),
        Buffer.from("abcd"),
        1,
        "my bad error"
      ),
      outputMessage(greetResponse("Hello")),
    ]);
  });
});
