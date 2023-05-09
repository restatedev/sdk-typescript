import { describe, expect } from "@jest/globals";
import * as restate from "../src/public_api";
import { TestDriver } from "./testdriver";
import {
  backgroundInvokeMessage,
  checkError,
  completionMessage,
  greetRequest,
  greetResponse,
  inputMessage,
  invokeMessage,
  outputMessage,
  setStateMessage,
  startMessage,
  suspensionMessage,
} from "./protoutils";
import {
  protoMetadata,
  TestGreeter,
  TestGreeterClientImpl,
  TestRequest,
  TestResponse,
} from "../src/generated/proto/test";
import { Failure } from "../src/generated/proto/protocol";
import { ProtocolMode } from "../src/generated/proto/discovery";

class ReverseAwaitOrder implements TestGreeter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    const client = new TestGreeterClientImpl(ctx);
    const greetingPromise1 = client.greet(
      TestRequest.create({ name: "Francesco" })
    );
    const greetingPromise2 = client.greet(TestRequest.create({ name: "Till" }));

    const greeting2 = await greetingPromise2;
    ctx.set<string>("A2", greeting2.greeting);

    const greeting1 = await greetingPromise1;

    return TestResponse.create({
      greeting: `Hello ${greeting1.greeting}-${greeting2.greeting}`,
    });
  }
}

class BackgroundInvokeGreeter implements TestGreeter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    const client = new TestGreeterClientImpl(ctx);
    await ctx.inBackground(() =>
      client.greet(TestRequest.create({ name: "Francesco" }))
    );

    return TestResponse.create({ greeting: `Hello` });
  }
}

class FailingBackgroundInvokeGreeter implements TestGreeter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    await ctx.inBackground(async () => ctx.set("state", 13));

    return TestResponse.create({ greeting: `Hello` });
  }
}
class FailingSideEffectInBackgroundInvokeGreeter implements TestGreeter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    await ctx.inBackground(async () => ctx.sideEffect(async () => 13));

    return TestResponse.create({ greeting: `Hello` });
  }
}

describe("ReverseAwaitOrder: None completed", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new ReverseAwaitOrder(),
      "/test.TestGreeter/Greet",
      [startMessage(1), inputMessage(greetRequest("Till"))]
    ).run();

    expect(result).toStrictEqual([
      invokeMessage("test.TestGreeter", "Greet", greetRequest("Francesco")),
      invokeMessage("test.TestGreeter", "Greet", greetRequest("Till")),
      suspensionMessage([1, 2]),
    ]);
  });
});

describe("ReverseAwaitOrder: Request-response: None completed", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new ReverseAwaitOrder(),
      "/test.TestGreeter/Greet",
      [startMessage(1), inputMessage(greetRequest("Till"))],
      ProtocolMode.REQUEST_RESPONSE
    ).run();

    expect(result).toStrictEqual([
      invokeMessage("test.TestGreeter", "Greet", greetRequest("Francesco")),
      invokeMessage("test.TestGreeter", "Greet", greetRequest("Till")),
      suspensionMessage([1, 2]),
    ]);
  });
});

describe("ReverseAwaitOrder: A1 and A2 completed later", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new ReverseAwaitOrder(),
      "/test.TestGreeter/Greet",
      [
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(1, greetResponse("FRANCESCO")),
        completionMessage(2, greetResponse("TILL")),
      ]
    ).run();

    expect(result).toStrictEqual([
      invokeMessage("test.TestGreeter", "Greet", greetRequest("Francesco")),
      invokeMessage("test.TestGreeter", "Greet", greetRequest("Till")),
      setStateMessage("A2", "TILL"),
      outputMessage(greetResponse("Hello FRANCESCO-TILL")),
    ]);
  });
});

describe("ReverseAwaitOrder: A2 and A1 completed later", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new ReverseAwaitOrder(),
      "/test.TestGreeter/Greet",
      [
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(2, greetResponse("TILL")),
        completionMessage(1, greetResponse("FRANCESCO")),
      ]
    ).run();

    expect(result).toStrictEqual([
      invokeMessage("test.TestGreeter", "Greet", greetRequest("Francesco")),
      invokeMessage("test.TestGreeter", "Greet", greetRequest("Till")),
      setStateMessage("A2", "TILL"),
      outputMessage(greetResponse("Hello FRANCESCO-TILL")),
    ]);
  });
});

describe("ReverseAwaitOrder: replay all invoke messages and setstate ", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new ReverseAwaitOrder(),
      "/test.TestGreeter/Greet",
      [
        startMessage(4),
        inputMessage(greetRequest("Till")),
        invokeMessage(
          "test.TestGreeter",
          "Greet",
          greetRequest("Francesco"),
          greetResponse("FRANCESCO")
        ),
        invokeMessage(
          "test.TestGreeter",
          "Greet",
          greetRequest("Till"),
          greetResponse("TILL")
        ),
        setStateMessage("A2", "TILL"),
      ]
    ).run();

    expect(result).toStrictEqual([
      outputMessage(greetResponse("Hello FRANCESCO-TILL")),
    ]);
  });
});

describe("ReverseAwaitOrder: journal mismatch on Invoke - different service during replay", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new ReverseAwaitOrder(),
      "/test.TestGreeter/Greet",
      [
        startMessage(4),
        inputMessage(greetRequest("Till")),
        invokeMessage(
          "test.TestGreeterWrong", // should have been test.TestGreeter
          "Greet",
          greetRequest("Francesco"),
          greetResponse("FRANCESCO")
        ),
        invokeMessage(
          "test.TestGreeter",
          "Greet",
          greetRequest("Till"),
          greetResponse("TILL")
        ),
        setStateMessage("A2", "TILL"),
      ]
    ).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "Replayed journal entries did not correspond to the user code. The user code has to be deterministic!"
    );
  });
});

describe("ReverseAwaitOrder: journal mismatch on Invoke - different method during replay", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new ReverseAwaitOrder(),
      "/test.TestGreeter/Greet",
      [
        startMessage(4),
        inputMessage(greetRequest("Till")),
        invokeMessage(
          "test.TestGreeter",
          "Greetzz", // should have been Greet
          greetRequest("Francesco"),
          greetResponse("FRANCESCO")
        ),
        invokeMessage(
          "test.TestGreeter",
          "Greet",
          greetRequest("Till"),
          greetResponse("TILL")
        ),
        setStateMessage("A2", "TILL"),
      ]
    ).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "Replayed journal entries did not correspond to the user code. The user code has to be deterministic!"
    );
  });
});

describe("ReverseAwaitOrder: journal mismatch on Invoke - different request during replay", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new ReverseAwaitOrder(),
      "/test.TestGreeter/Greet",
      [
        startMessage(4),
        inputMessage(greetRequest("Till")),
        invokeMessage(
          "test.TestGreeter",
          "Greet", // should have been Greet
          greetRequest("AnotherName"),
          greetResponse("FRANCESCO")
        ),
        invokeMessage(
          "test.TestGreeter",
          "Greet",
          greetRequest("Till"),
          greetResponse("TILL")
        ),
        setStateMessage("A2", "TILL"),
      ]
    ).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "Replayed journal entries did not correspond to the user code. The user code has to be deterministic!"
    );
  });
});

describe("ReverseAwaitOrder: journal mismatch on Invoke - completed with BackgroundInvoke during replay", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new ReverseAwaitOrder(),
      "/test.TestGreeter/Greet",
      [
        startMessage(4),
        inputMessage(greetRequest("Till")),
        invokeMessage(
          "test.TestGreeter",
          "Greet", // should have been Greet
          greetRequest("Francesco"),
          greetResponse("FRANCESCO")
        ),
        backgroundInvokeMessage(
          "test.TestGreeter",
          "Greet",
          greetRequest("Till")
        ), // should have been an invoke message
        setStateMessage("A2", "TILL"),
      ]
    ).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "Replayed journal entries did not correspond to the user code. The user code has to be deterministic!"
    );
  });
});

describe("ReverseAwaitOrder: Failing A1", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new ReverseAwaitOrder(),
      "/test.TestGreeter/Greet",
      [
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(
          1,
          undefined,
          undefined,
          Failure.create({ code: 13, message: "Error" })
        ),
        completionMessage(2, greetResponse("TILL")),
      ]
    ).run();

    expect(result.length).toStrictEqual(4);
    expect(result[0]).toStrictEqual(
      invokeMessage("test.TestGreeter", "Greet", greetRequest("Francesco"))
    );
    expect(result[1]).toStrictEqual(
      invokeMessage("test.TestGreeter", "Greet", greetRequest("Till"))
    );
    expect(result[2]).toStrictEqual(setStateMessage("A2", "TILL"));
    checkError(result[3], "Error"); // Error comes from the failed completion
  });
});

// async calls
describe("BackgroundInvokeGreeter: background call ", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new BackgroundInvokeGreeter(),
      "/test.TestGreeter/Greet",
      [startMessage(1), inputMessage(greetRequest("Till"))]
    ).run();

    expect(result).toStrictEqual([
      backgroundInvokeMessage(
        "test.TestGreeter",
        "Greet",
        greetRequest("Francesco")
      ),
      outputMessage(greetResponse("Hello")),
    ]);
  });
});

describe("BackgroundInvokeGreeter: journal mismatch on BackgroundInvoke - Completed with invoke during replay. ", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new BackgroundInvokeGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(2),
        inputMessage(greetRequest("Till")),
        invokeMessage("test.TestGreeter", "Greet", greetRequest("Francesco")), // should have been BackgroundInvoke
      ]
    ).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "Replayed journal entries did not correspond to the user code. The user code has to be deterministic!"
    );
  });
});

describe("BackgroundInvokeGreeter: journal mismatch on BackgroundInvoke - Completed with BackgroundInvoke with different service name. ", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new BackgroundInvokeGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(2),
        inputMessage(greetRequest("Till")),
        backgroundInvokeMessage(
          "test.TestGreeterWrong", // should have been "test.TestGreeter"
          "Greet",
          greetRequest("Francesco")
        ),
      ]
    ).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "Replayed journal entries did not correspond to the user code. The user code has to be deterministic!"
    );
  });
});

describe("BackgroundInvokeGreeter: journal mismatch on BackgroundInvoke - Completed with BackgroundInvoke with different method. ", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new BackgroundInvokeGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(2),
        inputMessage(greetRequest("Till")),
        backgroundInvokeMessage(
          "test.TestGreeter",
          "Greetzzz", // should have been "Greet"
          greetRequest("Francesco")
        ),
      ]
    ).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "Replayed journal entries did not correspond to the user code. The user code has to be deterministic!"
    );
  });
});

describe("BackgroundInvokeGreeter: journal mismatch on BackgroundInvoke - Completed with BackgroundInvoke with different request. ", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new BackgroundInvokeGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(2),
        inputMessage(greetRequest("Till")),
        backgroundInvokeMessage(
          "test.TestGreeter",
          "Greet", // should have been "Greet"
          greetRequest("AnotherName")
        ),
      ]
    ).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "Replayed journal entries did not correspond to the user code. The user code has to be deterministic!"
    );
  });
});

describe("FailingBackgroundInvokeGreeter: failing background call ", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new FailingBackgroundInvokeGreeter(),
      "/test.TestGreeter/Greet",
      [startMessage(1), inputMessage(greetRequest("Till"))]
    ).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "Cannot do a set state from within a background call."
    );
  });
});

describe("FailingSideEffectInBackgroundInvokeGreeter: failing background call ", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new FailingSideEffectInBackgroundInvokeGreeter(),
      "/test.TestGreeter/Greet",
      [startMessage(1), inputMessage(greetRequest("Till"))]
    ).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "Cannot do a side effect from within a background call. Context method inBackground() can only be used to invoke other services in the background. e.g. ctx.inBackground(() => client.greet(my_request))"
    );
  });
});

// TODO also implement the other tests of the Java SDK.
