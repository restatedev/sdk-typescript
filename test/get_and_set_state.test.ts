import { describe, expect } from "@jest/globals";
import * as restate from "../src/public_api";
import { TestDriver } from "./testdriver";
import {
  checkError,
  clearStateMessage,
  completionMessage,
  getStateMessage,
  greetRequest,
  greetResponse,
  inputMessage,
  outputMessage,
  setStateMessage,
  startMessage,
  suspensionMessage,
} from "./protoutils";
import {
  protoMetadata,
  TestGreeter,
  TestRequest,
  TestResponse,
} from "../src/generated/proto/test";
import { ProtocolMode } from "../src/generated/proto/discovery";

class GetAndSetGreeter implements TestGreeter {
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    // state
    const state = (await ctx.get<string>("STATE")) || "nobody";

    ctx.set("STATE", request.name);

    return TestResponse.create({ greeting: `Hello ${state}` });
  }
}

class ClearStateGreeter implements TestGreeter {
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    // state
    const state = (await ctx.get<string>("STATE")) || "nobody";

    ctx.set("STATE", request.name);

    ctx.clear("STATE");

    return TestResponse.create({ greeting: `Hello ${state}` });
  }
}

enum OrderStatus {
  ORDERED,
  DELIVERED,
}

class GetAndSetEnumGreeter implements TestGreeter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    // state
    const oldState = await ctx.get<OrderStatus>("STATE");

    ctx.set("STATE", OrderStatus.ORDERED);

    const newState = await ctx.get<OrderStatus>("STATE");

    return TestResponse.create({ greeting: `Hello ${oldState} - ${newState}` });
  }
}

describe("GetAndSetGreeter: With GetState and SetState", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new GetAndSetGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(3),
        inputMessage(greetRequest("Till")),
        getStateMessage("STATE", "Francesco"),
        setStateMessage("STATE", "Till"),
      ]
    ).run();

    expect(result).toStrictEqual([
      outputMessage(greetResponse("Hello Francesco")),
    ]);
  });
});

describe("GetAndSetGreeter: journal mismatch on GetState. Completed with SetState during replay.", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new GetAndSetGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(3),
        inputMessage(greetRequest("Till")),
        setStateMessage("STATE", "Francesco"), // should have been getStateMessage
        setStateMessage("STATE", "Till"),
      ]
    ).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "Journal mismatch: Replayed journal entries did not correspond to the user code. The user code has to be deterministic!"
    );
  });
});

describe("GetAndSetGreeter: journal mismatch on SetState. Completed with GetState during replay.", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new GetAndSetGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(3),
        inputMessage(greetRequest("Till")),
        getStateMessage("STATE", "Francesco"),
        getStateMessage("STATE", "Till"), // should have been setStateMessage
      ]
    ).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "Journal mismatch: Replayed journal entries did not correspond to the user code. The user code has to be deterministic!"
    );
  });
});

describe("GetAndSetGreeter: journal mismatch on SetState. Completed with ClearState during replay.", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new GetAndSetGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(3),
        inputMessage(greetRequest("Till")),
        getStateMessage("STATE", "Francesco"),
        clearStateMessage("STATE"), // should have been setStateMessage
      ]
    ).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "Journal mismatch: Replayed journal entries did not correspond to the user code. The user code has to be deterministic!"
    );
  });
});

describe("GetAndSetGreeter: journal mismatch on SetState. Completed with different key.", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new GetAndSetGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(3),
        inputMessage(greetRequest("Till")),
        getStateMessage("STATE", "Francesco"),
        setStateMessage("STATEE", "Till"), // should have been STATE
      ]
    ).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "Journal mismatch: Replayed journal entries did not correspond to the user code. The user code has to be deterministic!"
    );
  });
});

describe("GetAndSetGreeter: journal mismatch on SetState. Completed with different value.", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new GetAndSetGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(3),
        inputMessage(greetRequest("Till")),
        getStateMessage("STATE", "Francesco"),
        setStateMessage("STATE", "AnotherName"), // should have been Francesco
      ]
    ).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "Journal mismatch: Replayed journal entries did not correspond to the user code. The user code has to be deterministic!"
    );
  });
});

describe("GetAndSetGreeter: With GetState already completed", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new GetAndSetGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(2),
        inputMessage(greetRequest("Till")),
        getStateMessage("STATE", "Francesco"),
      ]
    ).run();

    expect(result).toStrictEqual([
      setStateMessage("STATE", "Till"),
      outputMessage(greetResponse("Hello Francesco")),
    ]);
  });
});

describe("GetAndSetGreeter: Journal mismatch GetState gets completed with setState during replay.", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new GetAndSetGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(2),
        inputMessage(greetRequest("Till")),
        setStateMessage("STATE", "Francesco"), // should have been getStateMessage
      ]
    ).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "Journal mismatch: Replayed journal entries did not correspond to the user code. The user code has to be deterministic!"
    );
  });
});

describe("GetAndSetGreeter: Journal mismatch GetState gets completed with different key.", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new GetAndSetGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(2),
        inputMessage(greetRequest("Till")),
        getStateMessage("STATEE"), // should have been STATE
      ]
    ).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "Journal mismatch: Replayed journal entries did not correspond to the user code. The user code has to be deterministic!"
    );
  });
});

describe("GetAndSetGreeter: With GetState completed later", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new GetAndSetGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(1, JSON.stringify("Francesco")),
      ]
    ).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      setStateMessage("STATE", "Till"),
      outputMessage(greetResponse("Hello Francesco")),
    ]);
  });
});

describe("GetAndSetGreeter: Request-response with GetState and suspension", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new GetAndSetGreeter(),
      "/test.TestGreeter/Greet",
      [startMessage(1), inputMessage(greetRequest("Till"))],
      ProtocolMode.REQUEST_RESPONSE
    ).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      suspensionMessage([1]),
    ]);
  });
});

describe("ClearState: With ClearState completed later", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new ClearStateGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(1, JSON.stringify("Francesco")),
      ]
    ).run();

    expect(result).toStrictEqual([
      getStateMessage("STATE"),
      setStateMessage("STATE", "Till"),
      clearStateMessage("STATE"),
      outputMessage(greetResponse("Hello Francesco")),
    ]);
  });
});

describe("ClearState: With ClearState already completed", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new ClearStateGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(4),
        inputMessage(greetRequest("Till")),
        getStateMessage("STATE", "Francesco"),
        setStateMessage("STATE", "Till"),
        clearStateMessage("STATE"),
      ]
    ).run();

    expect(result).toStrictEqual([
      outputMessage(greetResponse("Hello Francesco")),
    ]);
  });
});

/**
 * ClearState journal mismatch checks
 */

describe("ClearState: ClearState journal mismatch check on ClearState - completion with GetState during replay.", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new ClearStateGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(4),
        inputMessage(greetRequest("Till")),
        getStateMessage("STATE", "Francesco"),
        setStateMessage("STATE", "Till"),
        getStateMessage("STATE"), // this should have been a clearStateMessage
      ]
    ).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "Journal mismatch: Replayed journal entries did not correspond to the user code. The user code has to be deterministic!"
    );
  });
});

describe("ClearState: ClearState journal mismatch check on ClearState - completion with setState during replay.", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new ClearStateGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(4),
        inputMessage(greetRequest("Till")),
        getStateMessage("STATE", "Francesco"),
        setStateMessage("STATE", "Till"),
        setStateMessage("STATE", "Till"), // this should have been a clearStateMessage
      ]
    ).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "Journal mismatch: Replayed journal entries did not correspond to the user code. The user code has to be deterministic!"
    );
  });
});

describe("ClearState: ClearState journal mismatch check on ClearState - completion with different state key.", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new ClearStateGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(4),
        inputMessage(greetRequest("Till")),
        getStateMessage("STATE", "Francesco"),
        setStateMessage("STATE", "Till"),
        clearStateMessage("STATEE"), // this should have been STATE
      ]
    ).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "Journal mismatch: Replayed journal entries did not correspond to the user code. The user code has to be deterministic!"
    );
  });
});

describe("GetAndSetEnumGreeter: With GetState and SetState and with enum state replayed", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new GetAndSetEnumGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(4),
        inputMessage(greetRequest("Till")),
        getStateMessage("STATE", OrderStatus.DELIVERED),
        setStateMessage("STATE", OrderStatus.ORDERED),
        getStateMessage("STATE", OrderStatus.ORDERED),
      ]
    ).run();

    expect(result).toStrictEqual([outputMessage(greetResponse("Hello 1 - 0"))]);
  });
});

describe("GetAndSetEnumGreeter: With GetState and SetState and with empty enum state replayed", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new GetAndSetEnumGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(4),
        inputMessage(greetRequest("Till")),
        getStateMessage("STATE", undefined, true),
        setStateMessage("STATE", OrderStatus.ORDERED),
        getStateMessage("STATE", OrderStatus.ORDERED),
      ]
    ).run();

    expect(result).toStrictEqual([
      outputMessage(greetResponse("Hello null - 0")),
    ]);
  });
});
