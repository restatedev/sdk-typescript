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
  END_MESSAGE,
} from "./protoutils";
import { TestDriver, TestGreeter, TestResponse } from "./testdriver";
import { describe, expect, it } from "vitest";

class ResolveAwakeableGreeter implements TestGreeter {
  constructor(readonly payload: string | undefined) {}

  // eslint-disable-next-line @typescript-eslint/require-await
  async greet(ctx: restate.ObjectContext): Promise<TestResponse> {
    const awakeableIdentifier = getAwakeableId(1);
    ctx.resolveAwakeable(awakeableIdentifier, this.payload);

    return { greeting: `Hello` };
  }
}

describe("ResolveAwakeableGreeter", () => {
  it("sends message to runtime", async () => {
    const result = await new TestDriver(new ResolveAwakeableGreeter("hello"), [
      startMessage({}),
      inputMessage(greetRequest("Till")),
    ]).run();

    expect(result).toStrictEqual([
      resolveAwakeableMessage(getAwakeableId(1), "hello"),
      outputMessage(greetResponse("Hello")),
      END_MESSAGE,
    ]);
  });

  it("resolve with undefined value", async () => {
    const result = await new TestDriver(
      new ResolveAwakeableGreeter(undefined),
      [startMessage({}), inputMessage(greetRequest("Till"))]
    ).run();

    expect(result).toStrictEqual([
      resolveAwakeableMessage(getAwakeableId(1), null),
      outputMessage(greetResponse("Hello")),
      END_MESSAGE,
    ]);
  });

  it("sends message to runtime for empty string", async () => {
    const result = await new TestDriver(new ResolveAwakeableGreeter(""), [
      startMessage({}),
      inputMessage(greetRequest("Till")),
    ]).run();

    expect(result).toStrictEqual([
      resolveAwakeableMessage(getAwakeableId(1), ""),
      outputMessage(greetResponse("Hello")),
      END_MESSAGE,
    ]);
  });

  it("handles replay with value", async () => {
    const result = await new TestDriver(new ResolveAwakeableGreeter("hello"), [
      startMessage({}),
      inputMessage(greetRequest("Till")),
      resolveAwakeableMessage(getAwakeableId(1), "hello"),
    ]).run();

    expect(result).toStrictEqual([
      outputMessage(greetResponse("Hello")),
      END_MESSAGE,
    ]);
  });

  it("handles replay with value empty string", async () => {
    const result = await new TestDriver(new ResolveAwakeableGreeter(""), [
      startMessage({}),
      inputMessage(greetRequest("Till")),
      resolveAwakeableMessage(getAwakeableId(1), ""),
    ]).run();

    expect(result).toStrictEqual([
      outputMessage(greetResponse("Hello")),
      END_MESSAGE,
    ]);
  });

  it("fails on journal mismatch. Completed with invoke during replay.", async () => {
    const result = await new TestDriver(new ResolveAwakeableGreeter("hello"), [
      startMessage({}),
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

  it("fails on journal mismatch. Completed with wrong id.", async () => {
    const result = await new TestDriver(new ResolveAwakeableGreeter("hello"), [
      startMessage({ knownEntries: 2 }),
      inputMessage(greetRequest("Till")),
      resolveAwakeableMessage(
        "1234", // this should have been getAwakeableId(1)
        "hello"
      ),
    ]).run();

    expect(result.length).toStrictEqual(1);
    checkJournalMismatchError(result[0]);
  });
});

class RejectAwakeableGreeter implements TestGreeter {
  constructor(readonly reason: string) {}

  // eslint-disable-next-line @typescript-eslint/require-await
  async greet(ctx: restate.ObjectContext): Promise<TestResponse> {
    const awakeableIdentifier = getAwakeableId(1);
    ctx.rejectAwakeable(awakeableIdentifier, this.reason);

    return { greeting: `Hello` };
  }
}

describe("RejectAwakeableGreeter", () => {
  it("sends message to runtime", async () => {
    const result = await new TestDriver(
      new RejectAwakeableGreeter("my bad error"),
      [startMessage({}), inputMessage(greetRequest("Till"))]
    ).run();

    expect(result).toStrictEqual([
      rejectAwakeableMessage(getAwakeableId(1), "my bad error"),
      outputMessage(greetResponse("Hello")),
      END_MESSAGE,
    ]);
  });
});
