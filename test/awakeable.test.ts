import { describe, expect } from "@jest/globals";
import * as restate from "../src/public_api";
import { TestDriver } from "./testdriver";
import {
  awakeableMessage, checkError,
  completeAwakeableMessage,
  completionMessage,
  greetRequest,
  greetResponse,
  inputMessage, invokeMessage,
  outputMessage,
  startMessage,
  suspensionMessage
} from "./protoutils";
import { AwakeableIdentifier } from "../src/types/protocol";
import {
  protoMetadata,
  TestGreeter,
  TestRequest,
  TestResponse,
} from "../src/generated/proto/test";
import { ProtocolMode } from "../src/generated/proto/discovery";

class AwakeableGreeter implements TestGreeter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    const result = await ctx.awakeable<string>();

    return TestResponse.create({ greeting: `Hello ${result}` });
  }
}

class CompleteAwakeableGreeter implements TestGreeter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    const awakeableIdentifier = new AwakeableIdentifier(
      "TestGreeter",
      Buffer.from("123"),
      Buffer.from("abcd"),
      1
    );
    ctx.completeAwakeable(awakeableIdentifier, "hello");

    return TestResponse.create({ greeting: `Hello` });
  }
}

describe("AwakeableGreeter: with awakeable completion replay", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new AwakeableGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(2),
        inputMessage(greetRequest("Till")),
        awakeableMessage("Francesco"),
      ]
    ).run();

    expect(result).toStrictEqual([
      outputMessage(greetResponse("Hello Francesco")),
    ]);
  });
});


describe("AwakeableGreeter: journal mismatch on AwakeableMessage. Completed with CompleteAwakeable during replay.", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new AwakeableGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(2),
        inputMessage(greetRequest("Till")),
        completeAwakeableMessage(
          "TestGreeter",
          Buffer.from("123"),
          Buffer.from("abcd"),
          1,
          "hello"
        ), // should have been an awakeableMessage
      ]
    ).run();

    expect(result.length).toStrictEqual(1);
    checkError(result[0], "Journal mismatch: Replayed journal entries did not correspond to the user code. The user code has to be deterministic!")
  });
});

describe("AwakeableGreeter: without completion", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new AwakeableGreeter(),
      "/test.TestGreeter/Greet",
      [startMessage(1), inputMessage(greetRequest("Till"))]
    ).run();

    expect(result).toStrictEqual([awakeableMessage(), suspensionMessage([1])]);
  });
});

describe("AwakeableGreeter: request-response case", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new AwakeableGreeter(),
      "/test.TestGreeter/Greet",
      [startMessage(1), inputMessage(greetRequest("Till"))],
      ProtocolMode.REQUEST_RESPONSE
    ).run();

    expect(result).toStrictEqual([awakeableMessage(), suspensionMessage([1])]);
  });
});

describe("AwakeableGreeter: with completion", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new AwakeableGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(1, JSON.stringify("Francesco")),
      ]
    ).run();

    // BIDI mode: No suspension message because the completion will arrive before the timeout.
    expect(result).toStrictEqual([
      awakeableMessage(),
      outputMessage(greetResponse("Hello Francesco")),
    ]);
  });
});

describe("CompleteAwakeableGreeter: without completion", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new CompleteAwakeableGreeter(),
      "/test.TestGreeter/Greet",
      [startMessage(1), inputMessage(greetRequest("Till"))]
    ).run();

    expect(result).toStrictEqual([
      completeAwakeableMessage(
        "TestGreeter",
        Buffer.from("123"),
        Buffer.from("abcd"),
        1,
        "hello"
      ),
      outputMessage(greetResponse("Hello")),
    ]);
  });
});

describe("CompleteAwakeableGreeter: journal mismatch on CompleteAwakeable. Completed with invoke during replay.", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new CompleteAwakeableGreeter(),
      "/test.TestGreeter/Greet",
      [startMessage(2),
        inputMessage(greetRequest("Till")),
        invokeMessage(
          "test.TestGreeter",
          "Greet",
          greetRequest("Till"),
          greetResponse("TILL")
        ), // this should have been a completeawakeable
      ]
    ).run();

    expect(result.length).toStrictEqual(1);
    checkError(result[0], "Journal mismatch: Replayed journal entries did not correspond to the user code. The user code has to be deterministic!")
  });
});

describe("CompleteAwakeableGreeter: journal mismatch on CompleteAwakeable. Completed with wrong service name", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new CompleteAwakeableGreeter(),
      "/test.TestGreeter/Greet",
      [startMessage(2),
        inputMessage(greetRequest("Till")),
        completeAwakeableMessage(
          "TestGreeterzzz", // this should have been TestGreeter
          Buffer.from("123"),
          Buffer.from("abcd"),
          1,
          "hello"
        ),
      ]
    ).run();

    expect(result.length).toStrictEqual(1);
    checkError(result[0], "Journal mismatch: Replayed journal entries did not correspond to the user code. The user code has to be deterministic!")
  });
});

describe("CompleteAwakeableGreeter: journal mismatch on CompleteAwakeable. Completed with wrong instance key.", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new CompleteAwakeableGreeter(),
      "/test.TestGreeter/Greet",
      [startMessage(2),
        inputMessage(greetRequest("Till")),
        completeAwakeableMessage(
          "TestGreeter",
          Buffer.from("1234"), // this should have been a Buffer.from("123")
          Buffer.from("abcd"),
          1,
          "hello"
        ),
      ]
    ).run();

    expect(result.length).toStrictEqual(1);
    checkError(result[0], "Journal mismatch: Replayed journal entries did not correspond to the user code. The user code has to be deterministic!")
  });
});

describe("CompleteAwakeableGreeter: journal mismatch on CompleteAwakeable. Completed with wrong invocation id.", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new CompleteAwakeableGreeter(),
      "/test.TestGreeter/Greet",
      [startMessage(2),
        inputMessage(greetRequest("Till")),
        completeAwakeableMessage(
          "TestGreeter",
          Buffer.from("123"),
          Buffer.from("abcde"), // this should have been a Buffer.from("abcd")
          1,
          "hello"
        ),
      ]
    ).run();

    expect(result.length).toStrictEqual(1);
    checkError(result[0], "Journal mismatch: Replayed journal entries did not correspond to the user code. The user code has to be deterministic!")
  });
});

describe("CompleteAwakeableGreeter: journal mismatch on CompleteAwakeable. Completed with wrong entry index.", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new CompleteAwakeableGreeter(),
      "/test.TestGreeter/Greet",
      [startMessage(2),
        inputMessage(greetRequest("Till")),
        completeAwakeableMessage(
          "TestGreeter",
          Buffer.from("123"),
          Buffer.from("abcde"),
          2, // this should have been 1
          "hello"
        ),
      ]
    ).run();

    expect(result.length).toStrictEqual(1);
    checkError(result[0], "Journal mismatch: Replayed journal entries did not correspond to the user code. The user code has to be deterministic!")
  });
});


