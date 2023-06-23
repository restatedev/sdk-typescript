import {
  TestGreeter,
  TestRequest,
  TestResponse,
} from "../src/generated/proto/test";
import * as restate from "../src/public_api";
import { TestDriver } from "./testdriver";
import {
  clearStateMessage,
  completionMessage,
  getStateMessage,
  greetRequest,
  greetResponse,
  inputMessage,
  keyVal,
  outputMessage,
  setStateMessage,
  startMessage,
  suspensionMessage,
} from "./protoutils";
import { ProtocolMode } from "../src/generated/proto/discovery";

const input = inputMessage(greetRequest("Two"));
const COMPLETE_STATE = false;

class GetEmpty implements TestGreeter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    const stateIsEmpty = (await ctx.get<string>("STATE")) === null;

    return TestResponse.create({ greeting: `${stateIsEmpty}` });
  }
}

describe("GetEmpty", () => {
  it("handles complete state without key present", async () => {
    const result = await new TestDriver(
      new GetEmpty(),
      [startMessage(1, COMPLETE_STATE), input],
      ProtocolMode.BIDI_STREAM
    ).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE", undefined, true),
      outputMessage(greetResponse("true")),
    ]);
  });

  it("handles partial state without key present ", async () => {
    const result = await new TestDriver(
      new GetEmpty(),
      [startMessage(1), input],
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
      [startMessage(2), input, getStateMessage("STATE", undefined, true)],
      ProtocolMode.BIDI_STREAM
    ).run();

    expect(result).toStrictEqual([outputMessage(greetResponse("true"))]);
  });
});

class Get implements TestGreeter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    const state = (await ctx.get<string>("STATE")) || "nothing";

    return TestResponse.create({ greeting: state });
  }
}

describe("Get", () => {
  it("handles complete state with key present", async () => {
    const result = await new TestDriver(
      new Get(),
      [startMessage(1, COMPLETE_STATE, [keyVal("STATE", "One")]), input],
      ProtocolMode.BIDI_STREAM
    ).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE", "One"),
      outputMessage(greetResponse("One")),
    ]);
  });

  it("handles partial state with key present ", async () => {
    const result = await new TestDriver(
      new Get(),
      [startMessage(1, undefined, [keyVal("STATE", "One")]), input],
      ProtocolMode.BIDI_STREAM
    ).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE", "One"),
      outputMessage(greetResponse("One")),
    ]);
  });

  it("handles partial state without key present", async () => {
    const result = await new TestDriver(
      new Get(),
      [startMessage(2), input],
      ProtocolMode.BIDI_STREAM
    ).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      suspensionMessage([1]),
    ]);
  });
});

class GetAppendAndGet implements TestGreeter {
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

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
      [startMessage(1, COMPLETE_STATE, [keyVal("STATE", "One")]), input],
      ProtocolMode.BIDI_STREAM
    ).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE", "One"),
      setStateMessage("STATE", "OneTwo"),
      getStateMessage("STATE", "OneTwo"),
      outputMessage(greetResponse("OneTwo")),
    ]);
  });

  it("handles partial state with key not present ", async () => {
    const result = await new TestDriver(
      new GetAppendAndGet(),
      [startMessage(1), input, completionMessage(1, JSON.stringify("One"))],
      ProtocolMode.BIDI_STREAM
    ).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      setStateMessage("STATE", "OneTwo"),
      getStateMessage("STATE", "OneTwo"),
      outputMessage(greetResponse("OneTwo")),
    ]);
  });
});

class GetClearAndGet implements TestGreeter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

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
      [startMessage(1, COMPLETE_STATE, [keyVal("STATE", "One")]), input],
      ProtocolMode.BIDI_STREAM
    ).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE", "One"),
      clearStateMessage("STATE"),
      getStateMessage("STATE", undefined, true),
      outputMessage(greetResponse("One-nothing")),
    ]);
  });

  it("handles partial state with key not present ", async () => {
    const result = await new TestDriver(
      new GetClearAndGet(),
      [startMessage(1), input, completionMessage(1, JSON.stringify("One"))],
      ProtocolMode.BIDI_STREAM
    ).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      clearStateMessage("STATE"),
      getStateMessage("STATE", undefined, true),
      outputMessage(greetResponse("One-nothing")),
    ]);
  });
});

class MultipleGet implements TestGreeter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

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
      [startMessage(), input, completionMessage(1, JSON.stringify("One"))],
      ProtocolMode.BIDI_STREAM
    ).run();

    // First get goes to the runtime, the others get completed with local state
    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      getStateMessage("STATE", "One"),
      getStateMessage("STATE", "One"),
      outputMessage(greetResponse("One - One - One")),
    ]);
  });

  it("handles multiple gets with partial state not present with replay", async () => {
    const result = await new TestDriver(
      new MultipleGet(),
      [startMessage(), input, getStateMessage("STATE", "One")],
      ProtocolMode.BIDI_STREAM
    ).run();

    // First get goes to the runtime, the others get completed with local state
    expect(result).toStrictEqual([
      getStateMessage("STATE", "One"),
      getStateMessage("STATE", "One"),
      outputMessage(greetResponse("One - One - One")),
    ]);
  });
});
