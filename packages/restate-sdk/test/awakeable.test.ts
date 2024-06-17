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

import type * as restate from "../src/public_api.js";
import {
  awakeableMessage,
  checkJournalMismatchError,
  checkTerminalError,
  resolveAwakeableMessage,
  completionMessage,
  failure,
  getAwakeableId,
  greetRequest,
  greetResponse,
  inputMessage,
  outputMessage,
  startMessage,
  suspensionMessage,
  END_MESSAGE,
} from "./protoutils.js";

import type { TestGreeter } from "./testdriver.js";
import { TestDriver, TestResponse } from "./testdriver.js";
import { ProtocolMode } from "../src/types/discovery.js";
import { describe, expect, it } from "vitest";

class AwakeableGreeter implements TestGreeter {
  async greet(ctx: restate.ObjectContext): Promise<TestResponse> {
    const awakeable = ctx.awakeable<string>();

    const result = await awakeable.promise;

    return TestResponse.create({
      greeting: `Hello ${result} for ${awakeable.id}`,
    });
  }
}

describe("AwakeableGreeter", () => {
  it("sends message to runtime", async () => {
    const result = await new TestDriver(new AwakeableGreeter(), [
      startMessage({ key: "Till" }),
      inputMessage(greetRequest("Till")),
    ]).run();

    expect(result).toStrictEqual([awakeableMessage(), suspensionMessage([1])]);
  });

  it("sends message to runtime for request-response case", async () => {
    const result = await new TestDriver(
      new AwakeableGreeter(),
      [
        startMessage({ knownEntries: 1, key: "Till" }),
        inputMessage(greetRequest("Till")),
      ],
      ProtocolMode.REQUEST_RESPONSE
    ).run();

    expect(result).toStrictEqual([awakeableMessage(), suspensionMessage([1])]);
  });

  it("handles completion with value", async () => {
    const result = await new TestDriver(new AwakeableGreeter(), [
      startMessage({ key: "Till" }),
      inputMessage(greetRequest("Till")),
      completionMessage(1, JSON.stringify("Francesco")),
    ]).run();

    expect(result).toStrictEqual([
      awakeableMessage(),
      outputMessage(greetResponse(`Hello Francesco for ${getAwakeableId(1)}`)),
      END_MESSAGE,
    ]);
  });

  it("handles completion with empty string value", async () => {
    const result = await new TestDriver(new AwakeableGreeter(), [
      startMessage({ key: "Till" }),
      inputMessage(greetRequest("Till")),
      completionMessage(1, JSON.stringify("")),
    ]).run();

    expect(result).toStrictEqual([
      awakeableMessage(),
      outputMessage(greetResponse(`Hello  for ${getAwakeableId(1)}`)),
      END_MESSAGE,
    ]);
  });

  it("handles completion with empty object value", async () => {
    const result = await new TestDriver(new AwakeableGreeter(), [
      startMessage({ key: "Till" }),
      inputMessage(greetRequest("Till")),
      completionMessage(1, JSON.stringify({})),
    ]).run();

    expect(result).toStrictEqual([
      awakeableMessage(),
      outputMessage(
        greetResponse(`Hello [object Object] for ${getAwakeableId(1)}`)
      ),
      END_MESSAGE,
    ]);
  });

  it("handles completion with failure", async () => {
    const result = await new TestDriver(new AwakeableGreeter(), [
      startMessage({ key: "Till" }),
      inputMessage(greetRequest("Till")),
      completionMessage(
        1,
        undefined,
        undefined,
        failure("Something went wrong")
      ),
    ]).run();

    expect(result.length).toStrictEqual(3);
    expect(result[0]).toStrictEqual(awakeableMessage());
    checkTerminalError(result[1], "Something went wrong");
    expect(result[2]).toStrictEqual(END_MESSAGE);
  });

  it("handles replay with value", async () => {
    const result = await new TestDriver(new AwakeableGreeter(), [
      startMessage({ key: "Till" }),
      inputMessage(greetRequest("Till")),
      awakeableMessage("Francesco"),
    ]).run();

    expect(result).toStrictEqual([
      outputMessage(greetResponse(`Hello Francesco for ${getAwakeableId(1)}`)),
      END_MESSAGE,
    ]);
  });

  it("handles replay with failure", async () => {
    const result = await new TestDriver(new AwakeableGreeter(), [
      startMessage({ key: "Till" }),
      inputMessage(greetRequest("Till")),
      awakeableMessage(undefined, failure("Something went wrong")),
    ]).run();

    expect(result.length).toStrictEqual(2);
    checkTerminalError(result[0], "Something went wrong");
    expect(result[1]).toStrictEqual(END_MESSAGE);
  });

  it("fails on journal mismatch. Completed with CompleteAwakeable during replay.", async () => {
    const result = await new TestDriver(new AwakeableGreeter(), [
      startMessage({ key: "Till" }),
      inputMessage(greetRequest("Till")),
      resolveAwakeableMessage("awakeable-1", "hello"), // should have been an awakeableMessage
    ]).run();

    expect(result.length).toStrictEqual(1);
    checkJournalMismatchError(result[0]);
  });
});

class AwakeableNull implements TestGreeter {
  async greet(ctx: restate.ObjectContext): Promise<TestResponse> {
    const awakeable = ctx.awakeable();

    await awakeable.promise;

    return TestResponse.create({
      greeting: `Hello for ${awakeable.id}`,
    });
  }
}

describe("AwakeableNull", () => {
  it("handles completion with null value", async () => {
    const result = await new TestDriver(new AwakeableNull(), [
      startMessage({}),
      inputMessage(greetRequest("Till")),
      completionMessage(1, JSON.stringify(null)),
    ]).run();

    expect(result).toStrictEqual([
      awakeableMessage(),
      outputMessage(greetResponse(`Hello for ${getAwakeableId(1)}`)),
      END_MESSAGE,
    ]);
  });
});
