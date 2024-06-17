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

import type * as restate from "../src/public_api";
import type { TestGreeter, TestRequest } from "./testdriver";
import { TestDriver, TestResponse } from "./testdriver";
import {
  CLEAR_ALL_STATE_ENTRY_MESSAGE,
  clearStateMessage,
  completionMessage,
  completionMessageWithEmpty,
  END_MESSAGE,
  getStateMessage,
  getStateMessageWithEmptyResult,
  greetRequest,
  greetResponse,
  inputMessage,
  keyVal,
  outputMessage,
  setStateMessage,
  startMessage,
  suspensionMessage,
} from "./protoutils";
import { ProtocolMode } from "../src/types/discovery";

const input = inputMessage(greetRequest("Two"));
const COMPLETE_STATE = false;

class GetEmpty implements TestGreeter {
  async greet(ctx: restate.ObjectContext): Promise<TestResponse> {
    const stateIsEmpty = (await ctx.get<string>("STATE")) === null;

    return { greeting: `${stateIsEmpty}` };
  }
}

describe("GetEmpty", () => {
  it("handles complete state without key present", async () => {
    const result = await new TestDriver(
      new GetEmpty(),
      [startMessage({ knownEntries: 1, partialState: COMPLETE_STATE }), input],
      ProtocolMode.BIDI_STREAM
    ).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE", undefined, true),
      outputMessage(greetResponse("true")),
      END_MESSAGE,
    ]);
  });

  it("handles partial state without key present ", async () => {
    const result = await new TestDriver(
      new GetEmpty(),
      [startMessage({ knownEntries: 1 }), input],
      ProtocolMode.BIDI_STREAM
    ).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      suspensionMessage([1]),
    ]);
  });

  it("handles replay of partial state", async () => {
    const result = await new TestDriver(
      new GetEmpty(),
      [
        startMessage({ knownEntries: 2 }),
        input,
        getStateMessage("STATE", undefined, true),
      ],
      ProtocolMode.BIDI_STREAM
    ).run();

    expect(result).toStrictEqual([
      outputMessage(greetResponse("true")),
      END_MESSAGE,
    ]);
  });
});

class Get implements TestGreeter {
  async greet(ctx: restate.ObjectContext): Promise<TestResponse> {
    const state = (await ctx.get<string>("STATE")) || "nothing";

    return TestResponse.create({ greeting: state });
  }
}

describe("Get", () => {
  it("handles complete state with key present", async () => {
    const result = await new TestDriver(
      new Get(),
      [
        startMessage({
          knownEntries: 1,
          partialState: COMPLETE_STATE,
          state: [keyVal("STATE", "One")],
        }),
        input,
      ],
      ProtocolMode.BIDI_STREAM
    ).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE", "One"),
      outputMessage(greetResponse("One")),
      END_MESSAGE,
    ]);
  });

  it("handles partial state with key present ", async () => {
    const result = await new TestDriver(
      new Get(),
      [
        startMessage({ knownEntries: 1, state: [keyVal("STATE", "One")] }),
        input,
      ],
      ProtocolMode.BIDI_STREAM
    ).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE", "One"),
      outputMessage(greetResponse("One")),
      END_MESSAGE,
    ]);
  });

  it("handles partial state without key present", async () => {
    const result = await new TestDriver(
      new Get(),
      [startMessage({ knownEntries: 2 }), input],
      ProtocolMode.BIDI_STREAM
    ).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      suspensionMessage([1]),
    ]);
  });
});

class GetAppendAndGet implements TestGreeter {
  async greet(
    ctx: restate.ObjectContext,
    request: TestRequest
  ): Promise<TestResponse> {
    const oldState = (await ctx.get<string>("STATE")) || "nothing";
    ctx.set("STATE", oldState + request.name);
    const newState = (await ctx.get<string>("STATE")) || "nothing";

    return TestResponse.create({ greeting: newState });
  }
}

describe("GetAppendAndGet", () => {
  it("handles complete state with key present", async () => {
    const result = await new TestDriver(
      new GetAppendAndGet(),
      [
        startMessage({
          knownEntries: 1,
          partialState: COMPLETE_STATE,
          state: [keyVal("STATE", "One")],
        }),
        input,
      ],
      ProtocolMode.BIDI_STREAM
    ).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE", "One"),
      setStateMessage("STATE", "OneTwo"),
      getStateMessage("STATE", "OneTwo"),
      outputMessage(greetResponse("OneTwo")),
      END_MESSAGE,
    ]);
  });

  it("handles partial state with key not present ", async () => {
    const result = await new TestDriver(
      new GetAppendAndGet(),
      [
        startMessage({ knownEntries: 1 }),
        input,
        completionMessage(1, JSON.stringify("One")),
      ],
      ProtocolMode.BIDI_STREAM
    ).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      setStateMessage("STATE", "OneTwo"),
      getStateMessage("STATE", "OneTwo"),
      outputMessage(greetResponse("OneTwo")),
      END_MESSAGE,
    ]);
  });
});

class GetClearAndGet implements TestGreeter {
  async greet(ctx: restate.ObjectContext): Promise<TestResponse> {
    const oldState = (await ctx.get<string>("STATE")) || "not-nothing";
    ctx.clear("STATE");
    const newState = (await ctx.get<string>("STATE")) || "nothing";

    return TestResponse.create({ greeting: `${oldState}-${newState}` });
  }
}

describe("GetClearAndGet", () => {
  it("handles complete state with key present", async () => {
    const result = await new TestDriver(
      new GetClearAndGet(),
      [
        startMessage({
          knownEntries: 1,
          partialState: COMPLETE_STATE,
          state: [keyVal("STATE", "One")],
        }),
        input,
      ],
      ProtocolMode.BIDI_STREAM
    ).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE", "One"),
      clearStateMessage("STATE"),
      getStateMessage("STATE", undefined, true),
      outputMessage(greetResponse("One-nothing")),
      END_MESSAGE,
    ]);
  });

  it("handles partial state with key not present ", async () => {
    const result = await new TestDriver(
      new GetClearAndGet(),
      [
        startMessage({ knownEntries: 1 }),
        input,
        completionMessage(1, JSON.stringify("One")),
      ],
      ProtocolMode.BIDI_STREAM
    ).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      clearStateMessage("STATE"),
      getStateMessage("STATE", undefined, true),
      outputMessage(greetResponse("One-nothing")),
      END_MESSAGE,
    ]);
  });
});

class MultipleGet implements TestGreeter {
  async greet(ctx: restate.ObjectContext): Promise<TestResponse> {
    const state = (await ctx.get<string>("STATE")) || "nothing";
    const state1 = (await ctx.get<string>("STATE")) || "nothing";
    const state2 = (await ctx.get<string>("STATE")) || "nothing";

    return TestResponse.create({
      greeting: `${state} - ${state1} - ${state2}`,
    });
  }
}

describe("MultipleGet", () => {
  it("handles multiple gets with partial state not present with completion", async () => {
    const result = await new TestDriver(
      new MultipleGet(),
      [startMessage({}), input, completionMessage(1, JSON.stringify("One"))],
      ProtocolMode.BIDI_STREAM
    ).run();

    // First get goes to the runtime, the others get completed with local state
    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      getStateMessage("STATE", "One"),
      getStateMessage("STATE", "One"),
      outputMessage(greetResponse("One - One - One")),
      END_MESSAGE,
    ]);
  });

  it("handles multiple gets with partial state not present with replay", async () => {
    const result = await new TestDriver(
      new MultipleGet(),
      [startMessage({}), input, getStateMessage("STATE", "One")],
      ProtocolMode.BIDI_STREAM
    ).run();

    // First get goes to the runtime, the others get completed with local state
    expect(result).toStrictEqual([
      getStateMessage("STATE", "One"),
      getStateMessage("STATE", "One"),
      outputMessage(greetResponse("One - One - One")),
      END_MESSAGE,
    ]);
  });
});

class GetClearAllThenGet implements TestGreeter {
  async greet(ctx: restate.ObjectContext): Promise<TestResponse> {
    const state1 = (await ctx.get<string>("STATE")) || "nothing";
    const state2 = (await ctx.get<string>("ANOTHER_STATE")) || "nothing";

    ctx.clearAll();

    const state3 = (await ctx.get<string>("STATE")) || "nothing";
    const state4 = (await ctx.get<string>("ANOTHER_STATE")) || "nothing";

    return {
      greeting: [state1, state2, state3, state4].join(),
    };
  }
}

describe("GetClearAllThenGet", () => {
  it("with complete state in the eager state map", async () => {
    const result = await new TestDriver(
      new GetClearAllThenGet(),
      [
        startMessage({
          knownEntries: 1,
          partialState: false,
          state: [keyVal("STATE", "One")],
        }),
        inputMessage(greetRequest("bob")),
      ],
      ProtocolMode.REQUEST_RESPONSE
    ).run();

    // First get goes to the runtime, the others get completed with local state
    expect(result).toStrictEqual([
      getStateMessage("STATE", "One"),
      getStateMessageWithEmptyResult("ANOTHER_STATE"),
      CLEAR_ALL_STATE_ENTRY_MESSAGE,
      getStateMessageWithEmptyResult("STATE"),
      getStateMessageWithEmptyResult("ANOTHER_STATE"),
      outputMessage(
        greetResponse(["One", "nothing", "nothing", "nothing"].join())
      ),
      END_MESSAGE,
    ]);
  });

  it("with lazy state in the eager state map", async () => {
    const result = await new TestDriver(new GetClearAllThenGet(), [
      startMessage({
        knownEntries: 1,
        partialState: true,
        state: [keyVal("STATE", "One")],
      }),
      inputMessage(greetRequest("bob")),
      completionMessageWithEmpty(2),
    ]).run();

    // First get goes to the runtime, the others get completed with local state
    expect(result).toStrictEqual([
      getStateMessage("STATE", "One"),
      getStateMessage("ANOTHER_STATE"),
      CLEAR_ALL_STATE_ENTRY_MESSAGE,
      getStateMessageWithEmptyResult("STATE"),
      getStateMessageWithEmptyResult("ANOTHER_STATE"),
      outputMessage(
        greetResponse(["One", "nothing", "nothing", "nothing"].join())
      ),
      END_MESSAGE,
    ]);
  });
});
