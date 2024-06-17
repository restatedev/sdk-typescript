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

import * as restate from "../src/public_api";
import { TestDriver, TestGreeter, TestResponse } from "./testdriver";
import {
  completionMessage,
  END_MESSAGE,
  getStateKeysMessage,
  greetRequest,
  greetResponse,
  inputMessage,
  keyVal,
  outputMessage,
  startMessage,
  suspensionMessage,
} from "./protoutils";
import { GetStateKeysEntryMessage_StateKeys } from "../src/generated/proto/protocol_pb";
import { describe, expect, it } from "vitest";

const INPUT_MESSAGE = inputMessage(greetRequest("bob"));

function stateKeys(...keys: Array<string>): GetStateKeysEntryMessage_StateKeys {
  return new GetStateKeysEntryMessage_StateKeys({
    keys: keys.map((b) => Buffer.from(b)),
  });
}

class ListKeys implements TestGreeter {
  async greet(ctx: restate.ObjectContext): Promise<TestResponse> {
    return {
      greeting: (await ctx.stateKeys()).join(","),
    };
  }
}

describe("ListKeys", () => {
  it("with partial state suspends", async () => {
    const result = await new TestDriver(new ListKeys(), [
      startMessage({
        knownEntries: 1,
        partialState: true,
        state: [keyVal("A", "1")],
      }),
      INPUT_MESSAGE,
    ]).run();

    expect(result).toStrictEqual([
      getStateKeysMessage(),
      suspensionMessage([1]),
    ]);
  });

  it("with partial state", async () => {
    const result = await new TestDriver(new ListKeys(), [
      startMessage({
        knownEntries: 1,
        partialState: true,
        state: [keyVal("A", "1")],
      }),
      INPUT_MESSAGE,
      completionMessage(
        1,
        new GetStateKeysEntryMessage_StateKeys(stateKeys("B", "C")).toBinary()
      ),
    ]).run();

    expect(result).toStrictEqual([
      getStateKeysMessage(),
      outputMessage(greetResponse("B,C")),
      END_MESSAGE,
    ]);
  });

  it("with complete state", async () => {
    const result = await new TestDriver(new ListKeys(), [
      startMessage({
        knownEntries: 1,
        partialState: false,
        state: [keyVal("A", "1")],
      }),
      INPUT_MESSAGE,
    ]).run();

    expect(result).toStrictEqual([
      getStateKeysMessage(["A"]),
      outputMessage(greetResponse("A")),
      END_MESSAGE,
    ]);
  });

  it("replay", async () => {
    const result = await new TestDriver(new ListKeys(), [
      startMessage({
        knownEntries: 1,
        partialState: true,
        state: [keyVal("A", "1")],
      }),
      INPUT_MESSAGE,
      getStateKeysMessage(["A", "B", "C"]),
    ]).run();

    expect(result).toStrictEqual([
      outputMessage(greetResponse("A,B,C")),
      END_MESSAGE,
    ]);
  });
});
