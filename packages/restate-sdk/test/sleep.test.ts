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
  awakeableMessage,
  checkJournalMismatchError,
  checkTerminalError,
  completionMessage,
  END_MESSAGE,
  failure,
  greetRequest,
  greetResponse,
  inputMessage,
  outputMessage,
  setStateMessage,
  sleepMessage,
  startMessage,
  suspensionMessage,
} from "./protoutils";
import { SLEEP_ENTRY_MESSAGE_TYPE } from "../src/types/protocol";
import { Empty } from "@bufbuild/protobuf";
import { TestDriver, TestGreeter, TestResponse } from "./testdriver";
import { ProtocolMode } from "../src/types/discovery";

const wakeupTime = 1835661783000;

class SleepGreeter implements TestGreeter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(
    ctx: restate.ObjectContext
    /*request: TestRequest*/
  ): Promise<TestResponse> {
    await ctx.sleep(wakeupTime - Date.now());

    return TestResponse.create({ greeting: `Hello` });
  }
}

describe("SleepGreeter", () => {
  it("sends message to runtime", async () => {
    const result = await new TestDriver(new SleepGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
    ]).run();

    expect(result.length).toStrictEqual(2);
    expect(result[0].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result[1]).toStrictEqual(suspensionMessage([1]));
  });

  it("sends message to runtime for request-response mode", async () => {
    const result = await new TestDriver(
      new SleepGreeter(),
      [startMessage({ knownEntries: 1 }), inputMessage(greetRequest("Till"))],
      ProtocolMode.REQUEST_RESPONSE
    ).run();

    expect(result[0].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result[1]).toStrictEqual(suspensionMessage([1]));
  });

  it("handles completion with no empty", async () => {
    const result = await new TestDriver(new SleepGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      completionMessage(1),
    ]).run();

    expect(result.length).toStrictEqual(2);
    expect(result[0].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result[1]).toStrictEqual(suspensionMessage([1]));
  });

  it("handles completion with empty", async () => {
    const result = await new TestDriver(new SleepGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      completionMessage(1, new Empty().toBinary()),
    ]).run();

    expect(result.length).toStrictEqual(3);
    expect(result[0].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result[1]).toStrictEqual(outputMessage(greetResponse("Hello")));
    expect(result[2]).toStrictEqual(END_MESSAGE);
  });

  it("handles completion with failure", async () => {
    const result = await new TestDriver(new SleepGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      completionMessage(1, undefined, undefined, failure("Canceled")),
    ]).run();

    expect(result.length).toStrictEqual(3);
    expect(result[0].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    checkTerminalError(result[1], "Canceled");
    expect(result[2]).toStrictEqual(END_MESSAGE);
  });

  it("handles replay with no empty", async () => {
    const result = await new TestDriver(new SleepGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      sleepMessage(1000),
    ]).run();

    expect(result.length).toStrictEqual(1);
    expect(result[0]).toStrictEqual(suspensionMessage([1]));
  });

  it("handles replay with empty", async () => {
    const result = await new TestDriver(new SleepGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      sleepMessage(wakeupTime, new Empty({})),
    ]).run();

    expect(result.length).toStrictEqual(2);
    expect(result[0]).toStrictEqual(outputMessage(greetResponse("Hello")));
    expect(result[1]).toStrictEqual(END_MESSAGE);
  });

  it("handles replay with failure", async () => {
    const result = await new TestDriver(new SleepGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      sleepMessage(wakeupTime, undefined, failure("Canceled")),
    ]).run();

    expect(result.length).toStrictEqual(2);
    checkTerminalError(result[0], "Canceled");
    expect(result[1]).toStrictEqual(END_MESSAGE);
  });

  it("fails on journal mismatch. Completed with Awakeable.", async () => {
    const result = await new TestDriver(new SleepGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      awakeableMessage(""), // should have been a sleep message
    ]).run();

    expect(result.length).toStrictEqual(1);
    checkJournalMismatchError(result[0]);
  });
});

class ManySleepsGreeter implements TestGreeter {
  async greet(ctx: restate.ObjectContext): Promise<TestResponse> {
    await Promise.all(
      Array.from(Array(5).keys()).map(() => ctx.sleep(wakeupTime - Date.now()))
    );

    return TestResponse.create({ greeting: `Hello` });
  }
}

describe("ManySleepsGreeter: With sleep not complete", () => {
  it("sends message to the runtime for all sleeps", async () => {
    const result = await new TestDriver(new ManySleepsGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
    ]).run();

    expect(result[0].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result[1].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result[2].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result[3].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result[4].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result[5]).toStrictEqual(suspensionMessage([1, 2, 3, 4, 5]));
  });

  it("handles completions without empty for some of the sleeps", async () => {
    const result = await new TestDriver(new ManySleepsGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      completionMessage(4),
      completionMessage(2),
    ]).run();

    expect(result[0].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result[1].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result[2].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result[3].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result[4].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result[5]).toStrictEqual(suspensionMessage([1, 2, 3, 4, 5]));
  });

  it("handles completions with empty for some of the sleeps", async () => {
    const result = await new TestDriver(new ManySleepsGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      completionMessage(4, undefined, true),
      completionMessage(2, undefined, true),
    ]).run();

    expect(result[0].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result[1].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result[2].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result[3].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result[4].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result[5]).toStrictEqual(suspensionMessage([1, 3, 5]));
  });

  it("handles replay of all sleeps without empty", async () => {
    const result = await new TestDriver(new ManySleepsGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      sleepMessage(100),
      sleepMessage(100),
      sleepMessage(100),
      sleepMessage(100),
      sleepMessage(100),
    ]).run();

    expect(result[0]).toStrictEqual(suspensionMessage([1, 2, 3, 4, 5]));
  });

  it("handles replay of all sleeps some without empty and some with empty", async () => {
    const result = await new TestDriver(new ManySleepsGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      sleepMessage(100),
      sleepMessage(100, new Empty({})),
      sleepMessage(100),
      sleepMessage(100, new Empty({})),
      sleepMessage(100),
    ]).run();

    expect(result[0]).toStrictEqual(suspensionMessage([1, 3, 5]));
  });

  it("handles replay of all sleeps with empty", async () => {
    const result = await new TestDriver(new ManySleepsGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      sleepMessage(100, new Empty({})),
      sleepMessage(100, new Empty({})),
      sleepMessage(100, new Empty({})),
      sleepMessage(100, new Empty({})),
      sleepMessage(100, new Empty({})),
    ]).run();

    expect(result[0]).toStrictEqual(outputMessage(greetResponse("Hello")));
  });
});

class ManySleepsAndSetGreeter implements TestGreeter {
  async greet(ctx: restate.ObjectContext): Promise<TestResponse> {
    const mySleeps = Promise.all(
      Array.from(Array(5).keys()).map(() => ctx.sleep(wakeupTime - Date.now()))
    );
    ctx.set("state", "Hello");
    await mySleeps;

    return TestResponse.create({ greeting: `Hello` });
  }
}

describe("ManySleepsAndSetGreeter", () => {
  it("handles replays of all sleeps without empty", async () => {
    const result = await new TestDriver(new ManySleepsAndSetGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      sleepMessage(100),
      sleepMessage(100),
      sleepMessage(100),
      sleepMessage(100),
      sleepMessage(100),
    ]).run();

    expect(result[0]).toStrictEqual(setStateMessage("state", "Hello"));
    expect(result[1]).toStrictEqual(suspensionMessage([1, 2, 3, 4, 5]));
  });
});
