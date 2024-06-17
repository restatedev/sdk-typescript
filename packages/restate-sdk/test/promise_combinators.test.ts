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
import type { TestGreeter } from "./testdriver.js";
import { GreeterApi, TestDriver, TestResponse } from "./testdriver.js";
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
  sideEffectMessage,
  ackMessage,
  invokeMessage,
} from "./protoutils.js";
import {
  COMBINATOR_ENTRY_MESSAGE,
  SLEEP_ENTRY_MESSAGE_TYPE,
} from "../src/types/protocol.js";
import { TimeoutError } from "../src/types/errors.js";
import { CombineablePromise } from "../src/context.js";
import { Empty } from "../src/generated/proto/protocol_pb.js";
import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";

class AwakeableSleepRaceGreeter implements TestGreeter {
  async greet(ctx: restate.ObjectContext): Promise<TestResponse> {
    const awakeable = ctx.awakeable<string>();
    const sleep = ctx.sleep(1);

    const result = await CombineablePromise.race([awakeable.promise, sleep]);

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
      ackMessage(3),
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
      ackMessage(3),
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
      ackMessage(3),
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
      ackMessage(3),
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
      sleepMessage(1, new Empty()),
      combinatorEntryMessage(0, [2]),
    ]).run();

    expect(result).toStrictEqual([
      outputMessage(greetResponse(`Hello timed-out`)),
      END_MESSAGE,
    ]);
  });
});

class AwakeableSleepRaceInterleavedWithSideEffectGreeter
  implements TestGreeter
{
  async greet(ctx: restate.ObjectContext): Promise<TestResponse> {
    const awakeable = ctx.awakeable<string>();
    const sleep = ctx.sleep(1);
    const combinatorPromise = CombineablePromise.race([
      awakeable.promise,
      sleep,
    ]);

    await ctx.run(() => Promise.resolve("sideEffect"));

    // Because the combinatorPromise generates the message when awaited, the entries order here should be:
    // * AwakeableEntry
    // * SleepEntry
    // * SideEffectEntry
    // * CombinatorOrderEntry
    const result = await combinatorPromise;

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

describe("AwakeableSleepRaceInterleavedWithSideEffectGreeter", () => {
  it("generates the combinator entry after the side effect, when processing first time", async () => {
    const result = await new TestDriver(
      new AwakeableSleepRaceInterleavedWithSideEffectGreeter(),
      [
        startMessage(),
        inputMessage(greetRequest("Till")),
        completionMessage(1, JSON.stringify("Francesco")),
        ackMessage(3),
        ackMessage(4),
      ]
    ).run();

    expect(result.length).toStrictEqual(6);
    expect(result[0]).toStrictEqual(awakeableMessage());
    expect(result[1].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result.slice(2)).toStrictEqual([
      sideEffectMessage("sideEffect"),
      combinatorEntryMessage(0, [1]),
      outputMessage(greetResponse(`Hello Francesco for ${getAwakeableId(1)}`)),
      END_MESSAGE,
    ]);
  });

  it("generates the combinator entry after the side effect, when replaying up to sleep", async () => {
    const result = await new TestDriver(
      new AwakeableSleepRaceInterleavedWithSideEffectGreeter(),
      [
        startMessage(),
        inputMessage(greetRequest("Till")),
        awakeableMessage("Francesco"),
        sleepMessage(1),
        ackMessage(3),
        ackMessage(4),
      ]
    ).run();

    expect(result).toStrictEqual([
      sideEffectMessage("sideEffect"),
      combinatorEntryMessage(0, [1]),
      outputMessage(greetResponse(`Hello Francesco for ${getAwakeableId(1)}`)),
      END_MESSAGE,
    ]);
  });
});

class CombineablePromiseThenSideEffect implements TestGreeter {
  async greet(ctx: restate.ObjectContext): Promise<TestResponse> {
    const a1 = ctx.awakeable<string>();
    const a2 = ctx.awakeable<string>();
    const combinatorResult = await CombineablePromise.race([
      a1.promise,
      a2.promise,
    ]);

    const sideEffectResult = await ctx.run(() => Promise.resolve("sideEffect"));

    return TestResponse.create({
      greeting: combinatorResult + "-" + sideEffectResult,
    });
  }
}

describe("CombineablePromiseThenSideEffect", () => {
  it("after the combinator entry, suspends waiting for ack", async () => {
    const result = await new TestDriver(
      new CombineablePromiseThenSideEffect(),
      [
        startMessage(),
        inputMessage(greetRequest("Till")),
        awakeableMessage("Francesco"),
        awakeableMessage(),
      ]
    ).run();

    expect(result).toStrictEqual([
      combinatorEntryMessage(0, [1]),
      suspensionMessage([2, 3]),
    ]);
  });

  it("after the combinator entry, suspends waiting only for the combinator ack", async () => {
    const result = await new TestDriver(
      new CombineablePromiseThenSideEffect(),
      [
        startMessage(),
        inputMessage(greetRequest("Till")),
        awakeableMessage("Francesco"),
        awakeableMessage("Till"),
      ]
    ).run();

    expect(result.length).toStrictEqual(2);
    // We don't care if 1 or 2 was picked up.
    expect(result[0].messageType).toStrictEqual(COMBINATOR_ENTRY_MESSAGE);
    expect(result[1]).toStrictEqual(suspensionMessage([3]));
  });

  it("after the combinator entry and the ack, completes", async () => {
    const result = await new TestDriver(
      new CombineablePromiseThenSideEffect(),
      [
        startMessage(),
        inputMessage(greetRequest("Till")),
        awakeableMessage("Francesco"),
        awakeableMessage(),
        ackMessage(3),
        ackMessage(4),
      ]
    ).run();

    expect(result).toStrictEqual([
      combinatorEntryMessage(0, [1]),
      sideEffectMessage("sideEffect"),
      outputMessage(greetResponse(`Francesco-sideEffect`)),
      END_MESSAGE,
    ]);
  });

  it("no need to wait for ack when replaing the combinator entry", async () => {
    const result = await new TestDriver(
      new CombineablePromiseThenSideEffect(),
      [
        startMessage(),
        inputMessage(greetRequest("Till")),
        awakeableMessage("Francesco"),
        awakeableMessage(),
        combinatorEntryMessage(0, [1]),
        ackMessage(4),
      ]
    ).run();

    expect(result).toStrictEqual([
      sideEffectMessage("sideEffect"),
      outputMessage(greetResponse(`Francesco-sideEffect`)),
      END_MESSAGE,
    ]);
  });
});

class AwakeableOrTimeoutGreeter implements TestGreeter {
  async greet(ctx: restate.ObjectContext): Promise<TestResponse> {
    const { promise } = ctx.awakeable<string>();
    try {
      const result = await promise.orTimeout(100);
      return TestResponse.create({
        greeting: `Hello ${result}`,
      });
    } catch (e) {
      if (e instanceof TimeoutError) {
        return TestResponse.create({
          greeting: `Hello timed-out`,
        });
      }
    }

    throw new Error("Unexpected result");
  }
}

describe("AwakeableOrTimeoutGreeter", () => {
  it("handles completion of awakeable", async () => {
    const result = await new TestDriver(new AwakeableOrTimeoutGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      completionMessage(1, JSON.stringify("Francesco")),
      ackMessage(3),
    ]).run();

    expect(result.length).toStrictEqual(5);
    expect(result[0]).toStrictEqual(awakeableMessage());
    expect(result[1].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result.slice(2)).toStrictEqual([
      combinatorEntryMessage(0, [1]),
      outputMessage(greetResponse(`Hello Francesco`)),
      END_MESSAGE,
    ]);
  });

  it("handles completion of sleep", async () => {
    const result = await new TestDriver(new AwakeableOrTimeoutGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      completionMessage(2, undefined, true),
      ackMessage(3),
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
});

class InvokeRaceGreeter implements TestGreeter {
  async greet(ctx: restate.ObjectContext): Promise<TestResponse> {
    const jack = ctx.objectClient(GreeterApi, "Jack").greet({ name: "Jack" });
    const jill = ctx.objectClient(GreeterApi, "Jill").greet({ name: "Jill" });

    const result = await CombineablePromise.race([jack, jill]);

    return TestResponse.create({
      greeting: result.greeting,
    });
  }
}

describe("InvokeRaceGreeter", () => {
  const jackInvoke = invokeMessage(
    "greeter",
    "greet",
    Buffer.from(JSON.stringify({ name: "Jack" })),
    undefined,
    undefined,
    "Jack"
  );
  const jillInvoke = invokeMessage(
    "greeter",
    "greet",
    Buffer.from(JSON.stringify({ name: "Jill" })),
    undefined,
    undefined,
    "Jill"
  );

  it("should suspend without completions", async () => {
    const result = await new TestDriver(new InvokeRaceGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
    ]).run();

    expect(result.length).toStrictEqual(3);
    expect(result[0]).toStrictEqual(jackInvoke);
    expect(result[1]).toStrictEqual(jillInvoke);
    expect(result[2]).toStrictEqual(suspensionMessage([1, 2]));
  });

  it("handles completion of first invoke", async () => {
    const result = await new TestDriver(new InvokeRaceGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      completionMessage(1, greetResponse("Hi Jack")),
      ackMessage(3),
    ]).run();

    expect(result.length).toStrictEqual(5);
    expect(result[0]).toStrictEqual(jackInvoke);
    expect(result[1]).toStrictEqual(jillInvoke);
    expect(result.slice(2)).toStrictEqual([
      combinatorEntryMessage(0, [1]),
      outputMessage(greetResponse("Hi Jack")),
      END_MESSAGE,
    ]);
  });

  it("handles completion of second invoke", async () => {
    const result = await new TestDriver(new InvokeRaceGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      completionMessage(2, greetResponse("Hi Jill")),
      ackMessage(3),
    ]).run();

    expect(result.length).toStrictEqual(5);
    expect(result[0]).toStrictEqual(jackInvoke);
    expect(result[1]).toStrictEqual(jillInvoke);
    expect(result.slice(2)).toStrictEqual([
      combinatorEntryMessage(0, [2]),
      outputMessage(greetResponse(`Hi Jill`)),
      END_MESSAGE,
    ]);
  });

  it("handles replay of the first invoke", async () => {
    const result = await new TestDriver(new InvokeRaceGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      invokeMessage(
        "greeter",
        "greet",
        Buffer.from(JSON.stringify({ name: "Jack" })),
        greetResponse("Hi Jack"),
        undefined,
        "Jack"
      ),
      ackMessage(3),
    ]).run();

    expect(result.length).toStrictEqual(4);
    expect(result[0]).toStrictEqual(jillInvoke);
    expect(result.slice(1)).toStrictEqual([
      combinatorEntryMessage(0, [1]),
      outputMessage(greetResponse("Hi Jack")),
      END_MESSAGE,
    ]);
  });

  it("handles replay of both invokes", async () => {
    const result = await new TestDriver(new InvokeRaceGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      invokeMessage(
        "greeter",
        "greet",
        Buffer.from(JSON.stringify({ name: "Jack" })),
        greetResponse("Hi Jack"),
        undefined,
        "Jack"
      ),
      invokeMessage(
        "greeter",
        "greet",
        Buffer.from(JSON.stringify({ name: "Jill" })),
        greetResponse("Hi Jill"),
        undefined,
        "Jill"
      ),
      ackMessage(3),
    ]).run();

    expect(result).toStrictEqual([
      // The first invoke will be chosen because Promise.race will pick the first promise, in case both are resolved
      combinatorEntryMessage(0, [1, 2]),
      outputMessage(greetResponse("Hi Jack")),
      END_MESSAGE,
    ]);
  });

  it("handles replay of the combinator with first invoke completed", async () => {
    const result = await new TestDriver(new InvokeRaceGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      invokeMessage(
        "greeter",
        "greet",
        Buffer.from(JSON.stringify({ name: "Jack" })),
        greetResponse("Hi Jack"),
        undefined,
        "Jack"
      ),
      jillInvoke,
      combinatorEntryMessage(0, [1]),
    ]).run();

    expect(result).toStrictEqual([
      outputMessage(greetResponse("Hi Jack")),
      END_MESSAGE,
    ]);
  });

  it("handles replay of the combinator with second invoke completed", async () => {
    const result = await new TestDriver(new InvokeRaceGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      jackInvoke,
      invokeMessage(
        "greeter",
        "greet",
        Buffer.from(JSON.stringify({ name: "Jill" })),
        greetResponse("Hi Jill"),
        undefined,
        "Jill"
      ),
      combinatorEntryMessage(0, [2]),
    ]).run();

    expect(result).toStrictEqual([
      outputMessage(greetResponse("Hi Jill")),
      END_MESSAGE,
    ]);
  });
});
