import { describe, expect } from "@jest/globals";
import * as restate from "../src/public_api";
import { TestDriver } from "./testdriver";
import {
  completionMessage,
  inputMessage,
  outputMessage,
  sideEffectMessage,
  startMessage,
  greetRequest,
  greetResponse,
  decodeSideEffectFromResult,
  checkError,
  invokeMessage,
  getAwakeableId,
  backgroundInvokeMessage,
} from "./protoutils";
import {
  protoMetadata,
  TestGreeter,
  TestGreeterClientImpl,
  TestRequest,
  TestResponse,
} from "../src/generated/proto/test";
import { Failure } from "../src/generated/proto/protocol";
import { SIDE_EFFECT_ENTRY_MESSAGE_TYPE } from "../src/types/protocol";

class SideEffectGreeter implements TestGreeter {
  constructor(readonly sideEffectOutput: string) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    // state
    const response = await ctx.sideEffect(async () => {
      return this.sideEffectOutput;
    });

    return TestResponse.create({ greeting: `Hello ${response}` });
  }
}

class EmptySideEffectGreeter implements TestGreeter {
  constructor(readonly sideEffectOutput: string) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    // state
    await ctx.sideEffect(async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const something = true;
    });

    return TestResponse.create({ greeting: `Hello` });
  }
}

class NumericSideEffectGreeter implements TestGreeter {
  constructor(readonly sideEffectOutput: number) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    // state
    const response = await ctx.sideEffect(async () => {
      return this.sideEffectOutput;
    });

    return TestResponse.create({ greeting: `Hello ${response}` });
  }
}

class SideEffectAndInvokeGreeter implements TestGreeter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    const client = new TestGreeterClientImpl(ctx);

    // state
    const result = await ctx.sideEffect<string>(async () => "abcd");

    const greetingPromise1 = await client.greet(
      TestRequest.create({ name: result })
    );

    return TestResponse.create({
      greeting: `Hello ${greetingPromise1.greeting}`,
    });
  }
}

class SideEffectAndOneWayCallGreeter implements TestGreeter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    const client = new TestGreeterClientImpl(ctx);

    // state
    const result = await ctx.sideEffect<string>(async () => "abcd");

    await ctx.oneWayCall(() =>
      client.greet(TestRequest.create({ name: result }))
    );
    const response = await client.greet(TestRequest.create({ name: result }));

    return TestResponse.create({ greeting: `Hello ${response.greeting}` });
  }
}

class FailingSideEffectGreeter implements TestGreeter {
  constructor(readonly sideEffectOutput: number) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    // state
    const response = await ctx.sideEffect(async () => {
      throw new Error("Failing user code");
    });

    return TestResponse.create({ greeting: `Hello ${response}` });
  }
}

class FailingGetSideEffectGreeter implements TestGreeter {
  constructor(readonly sideEffectOutput: number) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    // state
    const response = await ctx.sideEffect(async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const state = await ctx.get("state");
      return this.sideEffectOutput;
    });

    return TestResponse.create({ greeting: `Hello ${response}` });
  }
}

class FailingSetSideEffectGreeter implements TestGreeter {
  constructor(readonly sideEffectOutput: number) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    // state
    const response = await ctx.sideEffect(async () => {
      ctx.set("state", 13);
      return this.sideEffectOutput;
    });

    return TestResponse.create({ greeting: `Hello ${response}` });
  }
}

class FailingClearSideEffectGreeter implements TestGreeter {
  constructor(readonly sideEffectOutput: number) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    // state
    const response = await ctx.sideEffect(async () => {
      ctx.clear("state");
      return this.sideEffectOutput;
    });

    return TestResponse.create({ greeting: `Hello ${response}` });
  }
}

class FailingNestedSideEffectGreeter implements TestGreeter {
  constructor(readonly sideEffectOutput: number) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    // state
    const response = await ctx.sideEffect(async () => {
      await ctx.sideEffect(async () => {
        return this.sideEffectOutput;
      });
    });

    return TestResponse.create({ greeting: `Hello ${response}` });
  }
}
class FailingNestedWithoutAwaitSideEffectGreeter implements TestGreeter {
  constructor(readonly sideEffectOutput: number) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    // state
    const response = await ctx.sideEffect(async () => {
      // without awaiting
      ctx.sideEffect(async () => {
        return this.sideEffectOutput;
      });
    });

    return TestResponse.create({ greeting: `Hello ${response}` });
  }
}

class FailingOneWayCallInSideEffectGreeter implements TestGreeter {
  constructor(readonly sideEffectOutput: number) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    // state
    const response = await ctx.sideEffect(async () => {
      await ctx.oneWayCall(async () => {
        return;
      });
    });

    return TestResponse.create({ greeting: `Hello ${response}` });
  }
}

class FailingSleepSideEffectGreeter implements TestGreeter {
  constructor(readonly sideEffectOutput: number) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    // state
    const response = await ctx.sideEffect(async () => {
      await ctx.sleep(1000);
    });

    return TestResponse.create({ greeting: `Hello ${response}` });
  }
}

class FailingCompleteAwakeableSideEffectGreeter implements TestGreeter {
  constructor(readonly sideEffectOutput: number) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    // state
    const response = await ctx.sideEffect(async () => {
      const awakeableIdentifier = getAwakeableId(1);
      ctx.completeAwakeable(awakeableIdentifier, "hello");
    });

    return TestResponse.create({ greeting: `Hello ${response}` });
  }
}

class FailingAwakeableSideEffectGreeter implements TestGreeter {
  constructor(readonly sideEffectOutput: number) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    // state
    const response = await ctx.sideEffect(async () => {
      ctx.awakeable<string>();
    });

    return TestResponse.create({ greeting: `Hello ${response}` });
  }
}

enum OrderStatus {
  ORDERED,
  DELIVERED,
}

class EnumSideEffectGreeter implements TestGreeter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    // state
    const response = await ctx.sideEffect(async () => {
      return OrderStatus.ORDERED;
    });

    return TestResponse.create({ greeting: `Hello ${response}` });
  }
}

describe("SideEffectGreeter: with ack", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new SideEffectGreeter("Francesco"),
      "/test.TestGreeter/Greet",
      [
        startMessage(2),
        inputMessage(greetRequest("Till")),
        sideEffectMessage("Francesco"),
      ]
    ).run();

    expect(result).toStrictEqual([
      outputMessage(greetResponse("Hello Francesco")),
    ]);
  });
});

describe("SideEffectGreeter: journal mismatch check on sideEffect - completed with Invoke", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new SideEffectGreeter("Francesco"),
      "/test.TestGreeter/Greet",
      [
        startMessage(2),
        inputMessage(greetRequest("Till")),
        invokeMessage(
          "test.TestGreeter",
          "Greet",
          greetRequest("Francesco"),
          greetResponse("FRANCESCO")
        ), // should have been side effect
      ]
    ).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "Replayed journal entries did not correspond to the user code. The user code has to be deterministic!"
    );
  });
});

describe("SideEffectGreeter: with completion", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new SideEffectGreeter("Francesco"),
      "/test.TestGreeter/Greet",
      [
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(1),
      ]
    ).run();

    expect(result).toStrictEqual([
      sideEffectMessage("Francesco"),
      outputMessage(greetResponse("Hello Francesco")),
    ]);
  });
});

describe("EmptySideEffectGreeter: with replay", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new EmptySideEffectGreeter("Francesco"),
      "/test.TestGreeter/Greet",
      [
        startMessage(2),
        inputMessage(greetRequest("Till")),
        sideEffectMessage({}),
      ]
    ).run();

    expect(result).toStrictEqual([outputMessage(greetResponse("Hello"))]);
  });
});

describe("EmptySideEffectGreeter: with completion", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new EmptySideEffectGreeter("Francesco"),
      "/test.TestGreeter/Greet",
      [
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(1),
      ]
    ).run();

    expect(result).toStrictEqual([
      sideEffectMessage({}),
      outputMessage(greetResponse("Hello")),
    ]);
  });
});

// Checks if the side effect flag is put back to false when we are in replay and do not execute the side effect
describe("SideEffectAndInvokeGreeter: side effect and then invoke. Side effect replayed.", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new SideEffectAndInvokeGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(2),
        inputMessage(greetRequest("Till")),
        sideEffectMessage("abcd"),
        completionMessage(2, greetResponse("FRANCESCO")),
      ]
    ).run();

    expect(result).toStrictEqual([
      invokeMessage("test.TestGreeter", "Greet", greetRequest("abcd")),
      outputMessage(greetResponse("Hello FRANCESCO")),
    ]);
  });
});

describe("SideEffectAndInvokeGreeter: side effect and then invoke. Side effect completed.", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new SideEffectAndInvokeGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(1),
        completionMessage(2, greetResponse("FRANCESCO")),
      ]
    ).run();

    expect(result).toStrictEqual([
      sideEffectMessage("abcd"),
      invokeMessage("test.TestGreeter", "Greet", greetRequest("abcd")),
      outputMessage(greetResponse("Hello FRANCESCO")),
    ]);
  });
});

// Checks if the side effect flag is put back to false when we are in replay and do not execute the side effect
describe("SideEffectAndOneWayCallGreeter: side effect and then invoke. Side effect replayed.", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new SideEffectAndOneWayCallGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(1),
        completionMessage(3, greetResponse("FRANCESCO")),
      ]
    ).run();

    expect(result).toStrictEqual([
      sideEffectMessage("abcd"),
      backgroundInvokeMessage(
        "test.TestGreeter",
        "Greet",
        greetRequest("abcd")
      ),
      invokeMessage("test.TestGreeter", "Greet", greetRequest("abcd")),
      outputMessage(greetResponse("Hello FRANCESCO")),
    ]);
  });
});

describe("SideEffectGreeter: without ack - numeric output", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new NumericSideEffectGreeter(123),
      "/test.TestGreeter/Greet",
      [
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(1),
      ]
    ).run();

    expect(result).toStrictEqual([
      sideEffectMessage(123),
      outputMessage(greetResponse("Hello 123")),
    ]);
  });
});

describe("EnumSideEffectGreeter: without ack - enum output", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new EnumSideEffectGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(1),
      ]
    ).run();

    expect(result).toStrictEqual([
      sideEffectMessage(OrderStatus.ORDERED),
      outputMessage(greetResponse("Hello 0")),
    ]);
  });
});

describe("FailingSideEffectGreeter: failing user code in side effect with ack", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new FailingSideEffectGreeter(123),
      "/test.TestGreeter/Greet",
      [
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(1),
      ]
    ).run();

    // When the user code fails we do want to see a side effect message with a failure
    // For invalid user code, we do not want to see this.
    expect(result.length).toStrictEqual(2);
    expect(result[0].messageType).toStrictEqual(SIDE_EFFECT_ENTRY_MESSAGE_TYPE);
    expect(
      decodeSideEffectFromResult(result[0].message).failure?.code
    ).toStrictEqual(13);
    checkError(result[1], "Failing user code");
  });
});

describe("FailingGetSideEffectGreeter: invalid get state in side effect with ack", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new FailingGetSideEffectGreeter(123),
      "/test.TestGreeter/Greet",
      [
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(1),
      ]
    ).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "You cannot do get state calls from within a side effect."
    );
  });
});

describe("FailingSetSideEffectGreeter: invalid set state in side effect with ack", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new FailingSetSideEffectGreeter(123),
      "/test.TestGreeter/Greet",
      [
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(1),
      ]
    ).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "You cannot do set state calls from within a side effect."
    );
  });
});

describe("FailingClearSideEffectGreeter: invalid clear state in side effect with ack", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new FailingClearSideEffectGreeter(123),
      "/test.TestGreeter/Greet",
      [
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(1),
      ]
    ).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "You cannot do clear state calls from within a side effect"
    );
  });
});

describe("FailingNestedSideEffectGreeter: invalid nested side effect in side effect with ack", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new FailingNestedSideEffectGreeter(123),
      "/test.TestGreeter/Greet",
      [startMessage(1), inputMessage(greetRequest("Till"))]
    ).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "You cannot do sideEffect calls from within a side effect."
    );
  });
});

describe("FailingNestedWithoutAwaitSideEffectGreeter: invalid nested side effect in side effect with ack", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new FailingNestedWithoutAwaitSideEffectGreeter(123),
      "/test.TestGreeter/Greet",
      [startMessage(1), inputMessage(greetRequest("Till"))]
    ).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "You cannot do sideEffect calls from within a side effect."
    );
  });
});

describe("FailingNestedSideEffectGreeter: invalid nested side effect in side effect with replay ack", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new FailingNestedSideEffectGreeter(123),
      "/test.TestGreeter/Greet",
      [
        startMessage(2),
        inputMessage(greetRequest("Till")),
        sideEffectMessage(
          undefined,
          Failure.create({
            code: 13,
            message:
              "Error: You cannot do sideEffect state calls from within a side effect.",
          })
        ),
      ]
    ).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "You cannot do sideEffect state calls from within a side effect"
    );
  });
});

describe("FailingNestedWithoutAwaitSideEffectGreeter: invalid nested side effect in side effect with replay ack", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new FailingNestedWithoutAwaitSideEffectGreeter(123),
      "/test.TestGreeter/Greet",
      [
        startMessage(2),
        inputMessage(greetRequest("Till")),
        sideEffectMessage(
          undefined,
          Failure.create({
            code: 13,
            message:
              "Error: You cannot do sideEffect state calls from within a side effect.",
          })
        ),
      ]
    ).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "You cannot do sideEffect state calls from within a side effect"
    );
  });
});

describe("FailingOneWayCallInSideEffectGreeter: invalid one-way call in side effect without ack", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new FailingOneWayCallInSideEffectGreeter(123),
      "/test.TestGreeter/Greet",
      [
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(1),
      ]
    ).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "You cannot do oneWayCall calls from within a side effect"
    );
  });
});

describe("FailingCompleteAwakeableSideEffectGreeter: invalid in complete awakeable call in side effect without ack", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new FailingCompleteAwakeableSideEffectGreeter(123),
      "/test.TestGreeter/Greet",
      [
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(1),
      ]
    ).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "You cannot do completeAwakeable calls from within a side effect."
    );
  });
});

describe("FailingSleepSideEffectGreeter: invalid in sleep call in side effect without ack", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new FailingSleepSideEffectGreeter(123),
      "/test.TestGreeter/Greet",
      [
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(1),
      ]
    ).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "You cannot do sleep calls from within a side effect."
    );
  });
});

describe("FailingAwakeableSideEffectGreeter: invalid in awakeable call in side effect without ack", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new FailingAwakeableSideEffectGreeter(123),
      "/test.TestGreeter/Greet",
      [
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(1),
      ]
    ).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "You cannot do awakeable calls from within a side effect."
    );
  });
});
