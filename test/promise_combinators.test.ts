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

import { describe, expect } from "@jest/globals";
import * as restate from "../src/public_api";
import { TestDriver } from "./testdriver";
import {
  awakeableMessage,
  completionMessage,
  getAwakeableId,
  greetRequest,
  greetResponse,
  inputMessage,
  outputMessage,
  startMessage,
  suspensionMessage,
  END_MESSAGE,
  combinatorEntryMessage,
  sleepMessage,
} from "./protoutils";
import { TestGreeter, TestResponse } from "../src/generated/proto/test";
import { SLEEP_ENTRY_MESSAGE_TYPE } from "../src/types/protocol";

class AwakeableSleepRaceGreeter implements TestGreeter {
  async greet(): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    const awakeable = ctx.awakeable<string>();
    const sleep = ctx.sleep(1);

    const result = await ctx.race([awakeable.promise, sleep]);

    if (typeof result === "string") {
      return TestResponse.create({
        greeting: `Hello ${result} for ${awakeable.id}`,
      });
    }

    return TestResponse.create({
      greeting: `Hello timed-out`,
    });
  }
}

describe("AwakeableSleepRaceGreeter", () => {
  it("should suspend without completions", async () => {
    const result = await new TestDriver(new AwakeableSleepRaceGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
    ]).run();

    expect(result.length).toStrictEqual(3);
    expect(result[0]).toStrictEqual(awakeableMessage());
    expect(result[1].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result[2]).toStrictEqual(suspensionMessage([1, 2]));
  });

  it("handles completion of awakeable", async () => {
    const result = await new TestDriver(new AwakeableSleepRaceGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      completionMessage(1, JSON.stringify("Francesco")),
    ]).run();

    expect(result.length).toStrictEqual(5);
    expect(result[0]).toStrictEqual(awakeableMessage());
    expect(result[1].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result.slice(2)).toStrictEqual([
      combinatorEntryMessage(0, [1]),
      outputMessage(greetResponse(`Hello Francesco for ${getAwakeableId(1)}`)),
      END_MESSAGE,
    ]);
  });

  it("handles completion of sleep", async () => {
    const result = await new TestDriver(new AwakeableSleepRaceGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      completionMessage(2, undefined, true),
    ]).run();

    expect(result.length).toStrictEqual(5);
    expect(result[0]).toStrictEqual(awakeableMessage());
    expect(result[1].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result.slice(2)).toStrictEqual([
      combinatorEntryMessage(0, [2]),
      outputMessage(greetResponse(`Hello timed-out`)),
      END_MESSAGE,
    ]);
  });

  it("handles replay of the awakeable", async () => {
    const result = await new TestDriver(new AwakeableSleepRaceGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      awakeableMessage("Francesco"),
    ]).run();

    expect(result.length).toStrictEqual(4);
    expect(result[0].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result.slice(1)).toStrictEqual([
      combinatorEntryMessage(0, [1]),
      outputMessage(greetResponse(`Hello Francesco for ${getAwakeableId(1)}`)),
      END_MESSAGE,
    ]);
  });

  it("handles replay of the awakeable and sleep", async () => {
    const result = await new TestDriver(new AwakeableSleepRaceGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      awakeableMessage("Francesco"),
      sleepMessage(1),
    ]).run();

    expect(result).toStrictEqual([
      // The awakeable will be chosen because Promise.race will pick the first promise, in case both are resolved
      combinatorEntryMessage(0, [1]),
      outputMessage(greetResponse(`Hello Francesco for ${getAwakeableId(1)}`)),
      END_MESSAGE,
    ]);
  });

  it("handles replay of the combinator with awakeable completed", async () => {
    const result = await new TestDriver(new AwakeableSleepRaceGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      awakeableMessage("Francesco"),
      sleepMessage(1),
      combinatorEntryMessage(0, [1]),
    ]).run();

    expect(result).toStrictEqual([
      outputMessage(greetResponse(`Hello Francesco for ${getAwakeableId(1)}`)),
      END_MESSAGE,
    ]);
  });

  it("handles replay of the combinator with sleep completed", async () => {
    const result = await new TestDriver(new AwakeableSleepRaceGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      awakeableMessage(),
      sleepMessage(1, {}),
      combinatorEntryMessage(0, [2]),
    ]).run();

    expect(result).toStrictEqual([
      outputMessage(greetResponse(`Hello timed-out`)),
      END_MESSAGE,
    ]);
  });
});
