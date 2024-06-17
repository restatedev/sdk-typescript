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
  checkJournalMismatchError,
  checkTerminalError,
  completionMessage,
  END_MESSAGE,
  failure,
  getStateMessage,
  greetRequest,
  greetResponse,
  inputMessage,
  outputMessage,
  setStateMessage,
  startMessage,
  suspensionMessage,
} from "./protoutils.js";
import type { TestGreeter } from "./testdriver.js";
import { TestDriver, TestResponse } from "./testdriver.js";
import { ProtocolMode } from "../src/types/discovery.js";
import { describe, expect, it } from "vitest";

class GetStringStateGreeter implements TestGreeter {
  async greet(ctx: restate.ObjectContext): Promise<TestResponse> {
    // state
    let state = await ctx.get<string>("STATE");
    if (state === null) {
      state = "nobody";
    }

    return TestResponse.create({ greeting: `Hello ${state}` });
  }
}

describe("GetStringStateGreeter", () => {
  it("sends message to runtime", async () => {
    const result = await new TestDriver(new GetStringStateGreeter(), [
      startMessage({}),
      inputMessage(greetRequest("Till")),
    ]).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      suspensionMessage([1]),
    ]);
  });

  it("sends message to runtime for request-response mode", async () => {
    const result = await new TestDriver(
      new GetStringStateGreeter(),
      [startMessage({ knownEntries: 1 }), inputMessage(greetRequest("Till"))],
      ProtocolMode.REQUEST_RESPONSE
    ).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      suspensionMessage([1]),
    ]);
  });

  it("handles completion with value", async () => {
    const result = await new TestDriver(new GetStringStateGreeter(), [
      startMessage({}),
      inputMessage(greetRequest("Till")),
      completionMessage(1, JSON.stringify("Francesco")),
    ]).run();

    expect(result[0]).toStrictEqual(getStateMessage("STATE"));
    expect(result[1]).toStrictEqual(
      outputMessage(greetResponse("Hello Francesco"))
    );
    expect(result[2]).toStrictEqual(END_MESSAGE);

    // expect(result).toBe([
    //   getStateMessage("STATE"),
    //   outputMessage(greetResponse("Hello Francesco")),
    //   END_MESSAGE,
    // ]);
  });

  it("handles completion with empty", async () => {
    const result = await new TestDriver(new GetStringStateGreeter(), [
      startMessage({}),
      inputMessage(greetRequest("Till")),
      completionMessage(1, undefined, true),
    ]).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      outputMessage(greetResponse("Hello nobody")),
      END_MESSAGE,
    ]);
  });

  it("handles completion with empty string", async () => {
    const result = await new TestDriver(new GetStringStateGreeter(), [
      startMessage({}),
      inputMessage(greetRequest("Till")),
      completionMessage(1, Buffer.from(JSON.stringify(""))),
    ]).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      outputMessage(greetResponse("Hello ")),
      END_MESSAGE,
    ]);
  });

  it("handles completion with failure", async () => {
    const result = await new TestDriver(new GetStringStateGreeter(), [
      startMessage({}),
      inputMessage(greetRequest("Till")),
      completionMessage(1, undefined, undefined, failure("Canceled")),
    ]).run();

    expect(result.length).toStrictEqual(3);
    expect(result[0]).toStrictEqual(getStateMessage("STATE"));
    checkTerminalError(result[1], "Canceled");
    expect(result[2]).toStrictEqual(END_MESSAGE);
  });

  it("handles replay with value", async () => {
    const result = await new TestDriver(new GetStringStateGreeter(), [
      startMessage({}),
      inputMessage(greetRequest("Till")),
      getStateMessage("STATE", "Francesco"),
    ]).run();

    expect(result).toStrictEqual([
      outputMessage(greetResponse("Hello Francesco")),
      END_MESSAGE,
    ]);
  });

  it("handles replay with empty", async () => {
    const result = await new TestDriver(new GetStringStateGreeter(), [
      startMessage({}),
      inputMessage(greetRequest("Till")),
      getStateMessage("STATE", undefined, true),
    ]).run();

    expect(result).toStrictEqual([
      outputMessage(greetResponse("Hello nobody")),
      END_MESSAGE,
    ]);
  });

  it("handles replay with failure", async () => {
    const result = await new TestDriver(new GetStringStateGreeter(), [
      startMessage({}),
      inputMessage(greetRequest("Till")),
      getStateMessage("STATE", undefined, undefined, failure("Canceled")),
    ]).run();

    expect(result.length).toStrictEqual(2);
    checkTerminalError(result[0], "Canceled");
    expect(result[1]).toStrictEqual(END_MESSAGE);
  });
});

class GetNumberStateGreeter implements TestGreeter {
  async greet(ctx: restate.ObjectContext): Promise<TestResponse> {
    // state
    const state = await ctx.get<number>("STATE");

    return TestResponse.create({ greeting: `Hello ${state}` });
  }
}

describe("GetNumberStateGreeter", () => {
  it("sends message to the runtime", async () => {
    const result = await new TestDriver(new GetNumberStateGreeter(), [
      startMessage({}),
      inputMessage(greetRequest("Till")),
    ]).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      suspensionMessage([1]),
    ]);
  });

  it("handles completion with value", async () => {
    const result = await new TestDriver(new GetNumberStateGreeter(), [
      startMessage({}),
      inputMessage(greetRequest("Till")),
      completionMessage(1, Buffer.from(JSON.stringify(70))),
    ]).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      outputMessage(greetResponse("Hello 70")),
      END_MESSAGE,
    ]);
  });

  it("handles completion with value 0", async () => {
    const result = await new TestDriver(new GetNumberStateGreeter(), [
      startMessage({}),
      inputMessage(greetRequest("Till")),
      completionMessage(1, Buffer.from(JSON.stringify(0))),
    ]).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      outputMessage(greetResponse("Hello 0")),
      END_MESSAGE,
    ]);
  });

  it("handles completion with empty", async () => {
    const result = await new TestDriver(new GetNumberStateGreeter(), [
      startMessage({}),
      inputMessage(greetRequest("Till")),
      completionMessage(1, undefined, true),
    ]).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      outputMessage(greetResponse("Hello null")),
      END_MESSAGE,
    ]);
  });

  it("handles replay with value", async () => {
    const result = await new TestDriver(new GetNumberStateGreeter(), [
      startMessage({}),
      inputMessage(greetRequest("Till")),
      getStateMessage<number>("STATE", 70),
    ]).run();

    expect(result).toStrictEqual([
      outputMessage(greetResponse("Hello 70")),
      END_MESSAGE,
    ]);
  });

  it("handles replay with value 0", async () => {
    const result = await new TestDriver(new GetNumberStateGreeter(), [
      startMessage({}),
      inputMessage(greetRequest("Till")),
      getStateMessage<number>("STATE", 0),
    ]).run();

    expect(result).toStrictEqual([
      outputMessage(greetResponse("Hello 0")),
      END_MESSAGE,
    ]);
  });

  it("handles replay with empty", async () => {
    const result = await new TestDriver(new GetNumberStateGreeter(), [
      startMessage({}),
      inputMessage(greetRequest("Till")),
      getStateMessage<number>("STATE", undefined, true),
    ]).run();

    expect(result).toStrictEqual([
      outputMessage(greetResponse("Hello null")),
      END_MESSAGE,
    ]);
  });

  it("fails on journal mismatch. Completed with SetStateMessage.", async () => {
    const result = await new TestDriver(new GetNumberStateGreeter(), [
      startMessage({}),
      inputMessage(greetRequest("Till")),
      setStateMessage("STATE", 0),
    ]).run();

    expect(result.length).toStrictEqual(1);
    checkJournalMismatchError(result[0]);
  });
});

class GetNumberListStateGreeter implements TestGreeter {
  async greet(ctx: restate.ObjectContext): Promise<TestResponse> {
    // state
    const state = await ctx.get<number[]>("STATE");
    if (state) {
      return TestResponse.create({
        greeting: `Hello index 0: ${state[0]} - index 1: ${state[1]}`,
      });
    } else {
      return TestResponse.create({ greeting: `Hello no state found` });
    }
  }
}

describe("GetNumberListStateGreeter", () => {
  it("sends message to runtime", async () => {
    const result = await new TestDriver(new GetNumberListStateGreeter(), [
      startMessage({}),
      inputMessage(greetRequest("Till")),
    ]).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      suspensionMessage([1]),
    ]);
  });

  it("handles completion with value", async () => {
    const result = await new TestDriver(new GetNumberListStateGreeter(), [
      startMessage({}),
      inputMessage(greetRequest("Till")),
      completionMessage(1, Buffer.from(JSON.stringify([5, 4]))),
    ]).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      outputMessage(greetResponse("Hello index 0: 5 - index 1: 4")),
      END_MESSAGE,
    ]);
  });

  it("handles completion with value empty list", async () => {
    const result = await new TestDriver(new GetNumberListStateGreeter(), [
      startMessage({}),
      inputMessage(greetRequest("Till")),
      completionMessage(1, Buffer.from(JSON.stringify([]))),
    ]).run();

    // For an empty list it will print undefined values for the first two indices
    // but still recognize it as a list
    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      outputMessage(
        greetResponse("Hello index 0: undefined - index 1: undefined")
      ),
      END_MESSAGE,
    ]);
  });

  it("handles completion with empty", async () => {
    const result = await new TestDriver(new GetNumberListStateGreeter(), [
      startMessage({}),
      inputMessage(greetRequest("Till")),
      completionMessage(1, undefined, true),
    ]).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      outputMessage(greetResponse("Hello no state found")),
      END_MESSAGE,
    ]);
  });

  it("handles replay with value", async () => {
    const result = await new TestDriver(new GetNumberListStateGreeter(), [
      startMessage({}),
      inputMessage(greetRequest("Till")),
      getStateMessage("STATE", [5, 4]),
    ]).run();

    expect(result).toStrictEqual([
      outputMessage(greetResponse("Hello index 0: 5 - index 1: 4")),
      END_MESSAGE,
    ]);
  });

  it("handles replay with value empty list", async () => {
    const result = await new TestDriver(new GetNumberListStateGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      getStateMessage("STATE", []),
    ]).run();

    expect(result).toStrictEqual([
      outputMessage(
        greetResponse("Hello index 0: undefined - index 1: undefined")
      ),
      END_MESSAGE,
    ]);
  });

  it("handles replay with value empty list", async () => {
    const result = await new TestDriver(new GetNumberListStateGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      getStateMessage("STATE", undefined, true),
    ]).run();

    expect(result).toStrictEqual([
      outputMessage(greetResponse("Hello no state found")),
      END_MESSAGE,
    ]);
  });

  it("fails on journal mismatch. Completed with wrong state key", async () => {
    const result = await new TestDriver(new GetNumberListStateGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      getStateMessage("STATEE", undefined, true),
    ]).run();

    expect(result.length).toStrictEqual(1);
    checkJournalMismatchError(result[0]);
  });
});
