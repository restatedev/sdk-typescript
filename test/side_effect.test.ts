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
  suspensionMessage,
  failure,
} from "./protoutils";
import {
  TestGreeter,
  TestGreeterClientImpl,
  TestRequest,
  TestResponse,
} from "../src/generated/proto/test";
import { Failure } from "../src/generated/proto/protocol";
import { SIDE_EFFECT_ENTRY_MESSAGE_TYPE } from "../src/types/protocol";
import { rlog } from "../src/utils/logger";

class SideEffectGreeter implements TestGreeter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(readonly sideEffectOutput: any) {}

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

describe("SideEffectGreeter", () => {
  it("sends message to runtime", async () => {
    const result = await new TestDriver(new SideEffectGreeter("Francesco"), [
      startMessage(),
      inputMessage(greetRequest("Till")),
    ]).run();

    expect(result).toStrictEqual([
      sideEffectMessage("Francesco"),
      suspensionMessage([1]),
    ]);
  });

  it("sends message to runtime for undefined result", async () => {
    const result = await new TestDriver(new SideEffectGreeter(undefined), [
      startMessage(),
      inputMessage(greetRequest("Till")),
    ]).run();

    expect(result).toStrictEqual([
      sideEffectMessage(undefined),
      suspensionMessage([1]),
    ]);
  });

  it("sends message to runtime for empty object", async () => {
    const result = await new TestDriver(new SideEffectGreeter({}), [
      startMessage(),
      inputMessage(greetRequest("Till")),
    ]).run();

    expect(result).toStrictEqual([
      sideEffectMessage({}),
      suspensionMessage([1]),
    ]);
  });

  it("handles completion", async () => {
    const result = await new TestDriver(new SideEffectGreeter("Francesco"), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      completionMessage(1),
    ]).run();

    expect(result).toStrictEqual([
      sideEffectMessage("Francesco"),
      outputMessage(greetResponse("Hello Francesco")),
    ]);
  });

  it("handles replay with undefined value", async () => {
    const result = await new TestDriver(new SideEffectGreeter("Francesco"), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      sideEffectMessage(),
    ]).run();

    expect(result).toStrictEqual([
      outputMessage(greetResponse("Hello undefined")),
    ]);
  });

  it("handles replay with empty object value", async () => {
    const result = await new TestDriver(new SideEffectGreeter({}), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      sideEffectMessage(),
    ]).run();

    expect(result).toStrictEqual([
      outputMessage(greetResponse("Hello undefined")),
    ]);
  });

  it("handles replay with value", async () => {
    const result = await new TestDriver(new SideEffectGreeter("Francesco"), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      sideEffectMessage("Francesco"),
    ]).run();

    expect(result).toStrictEqual([
      outputMessage(greetResponse("Hello Francesco")),
    ]);
  });

  it("handles replay with empty string", async () => {
    const result = await new TestDriver(new SideEffectGreeter("Francesco"), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      sideEffectMessage(""),
    ]).run();

    expect(result).toStrictEqual([outputMessage(greetResponse("Hello "))]);
  });

  it("handles replay with failure", async () => {
    const result = await new TestDriver(new SideEffectGreeter("Francesco"), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      sideEffectMessage(undefined, failure(13, "Something went wrong.")),
    ]).run();

    checkError(result[0], "Something went wrong.");
  });

  it("fails on journal mismatch. Completed with invoke.", async () => {
    const result = await new TestDriver(new SideEffectGreeter("Francesco"), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      invokeMessage(
        "test.TestGreeter",
        "Greet",
        greetRequest("Francesco"),
        greetResponse("FRANCESCO")
      ), // should have been side effect
    ]).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "Replayed journal entries did not correspond to the user code. The user code has to be deterministic!"
    );
  });
});

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

// Checks if the side effect flag is put back to false when we are in replay and do not execute the side effect
describe("SideEffectAndInvokeGreeter", () => {
  it("handles replay and then invoke.", async () => {
    const result = await new TestDriver(new SideEffectAndInvokeGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      sideEffectMessage("abcd"),
      completionMessage(2, greetResponse("FRANCESCO")),
    ]).run();

    expect(result).toStrictEqual([
      invokeMessage("test.TestGreeter", "Greet", greetRequest("abcd")),
      outputMessage(greetResponse("Hello FRANCESCO")),
    ]);
  });

  it("handles completion and then invoke", async () => {
    const result = await new TestDriver(new SideEffectAndInvokeGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      completionMessage(1),
      completionMessage(2, greetResponse("FRANCESCO")),
    ]).run();

    expect(result).toStrictEqual([
      sideEffectMessage("abcd"),
      invokeMessage("test.TestGreeter", "Greet", greetRequest("abcd")),
      outputMessage(greetResponse("Hello FRANCESCO")),
    ]);
  });
});

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

// Checks if the side effect flag is put back to false when we are in replay and do not execute the side effect
describe("SideEffectAndOneWayCallGreeter", () => {
  it("handles completion and then invoke", async () => {
    const result = await new TestDriver(new SideEffectAndOneWayCallGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      completionMessage(1),
      completionMessage(3, greetResponse("FRANCESCO")),
    ]).run();

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

  it("handles replay and then invoke", async () => {
    const result = await new TestDriver(new SideEffectAndOneWayCallGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      sideEffectMessage("abcd"),
      completionMessage(3, greetResponse("FRANCESCO")),
    ]).run();

    expect(result).toStrictEqual([
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

describe("NumericSideEffectGreeter", () => {
  it("handles completion", async () => {
    const result = await new TestDriver(new NumericSideEffectGreeter(123), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      completionMessage(1),
    ]).run();

    expect(result).toStrictEqual([
      sideEffectMessage(123),
      outputMessage(greetResponse("Hello 123")),
    ]);
  });

  it("handles replay with value", async () => {
    const result = await new TestDriver(new NumericSideEffectGreeter(123), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      sideEffectMessage(123),
    ]).run();

    expect(result).toStrictEqual([outputMessage(greetResponse("Hello 123"))]);
  });
});

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

describe("EnumSideEffectGreeter", () => {
  it("handles completion with value enum", async () => {
    const result = await new TestDriver(new EnumSideEffectGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      completionMessage(1),
    ]).run();

    expect(result).toStrictEqual([
      sideEffectMessage(OrderStatus.ORDERED),
      outputMessage(greetResponse("Hello 0")),
    ]);
  });

  it("handles replay with value enum", async () => {
    const result = await new TestDriver(new EnumSideEffectGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      sideEffectMessage(OrderStatus.ORDERED),
    ]).run();

    expect(result).toStrictEqual([outputMessage(greetResponse("Hello 0"))]);
  });
});

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

describe("FailingSideEffectGreeter", () => {
  it("fails on user-code error", async () => {
    const result = await new TestDriver(new FailingSideEffectGreeter(123), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      completionMessage(1),
    ]).run();

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

describe("FailingGetSideEffectGreeter", () => {
  it("fails on invalid operation getState in sideEffect", async () => {
    const result = await new TestDriver(new FailingGetSideEffectGreeter(123), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      completionMessage(1),
    ]).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "You cannot do get state calls from within a side effect."
    );
  });
});

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

describe("FailingSetSideEffectGreeter", () => {
  it("fails on invalid operation setState in sideEffect", async () => {
    const result = await new TestDriver(new FailingSetSideEffectGreeter(123), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      completionMessage(1),
    ]).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "You cannot do set state calls from within a side effect."
    );
  });
});

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

describe("FailingClearSideEffectGreeter", () => {
  it("fails on invalid operation clearState in sideEffect", async () => {
    const result = await new TestDriver(
      new FailingClearSideEffectGreeter(123),
      [startMessage(), inputMessage(greetRequest("Till")), completionMessage(1)]
    ).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "You cannot do clear state calls from within a side effect"
    );
  });
});

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

describe("FailingNestedSideEffectGreeter", () => {
  it("fails on invalid operation sideEffect in sideEffect", async () => {
    const result = await new TestDriver(
      new FailingNestedSideEffectGreeter(123),
      [startMessage(), inputMessage(greetRequest("Till"))]
    ).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "You cannot do sideEffect calls from within a side effect."
    );
  });

  it("fails on invalid replayed operation sideEffect in sideEffect", async () => {
    const result = await new TestDriver(
      new FailingNestedSideEffectGreeter(123),
      [
        startMessage(),
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

//TODO This test causes one of the later tests to fail
// it seems there is something not cleaned up correctly...
// describe("FailingNestedWithoutAwaitSideEffectGreeter: invalid nested side effect in side effect with ack", () => {
//   it("should call greet", async () => {
//     const result = await new TestDriver(
//       new FailingNestedWithoutAwaitSideEffectGreeter(123),
//       [startMessage(), inputMessage(greetRequest("Till"))]
//     ).run();
//
//     expect(result.length).toStrictEqual(1);
//     checkError(
//       result[0],
//       "You cannot do sideEffect calls from within a side effect."
//     );
//   });
// });

describe("FailingNestedWithoutAwaitSideEffectGreeter", () => {
  it("fails on invalid operation unawaited side effect in sideEffect", async () => {
    const result = await new TestDriver(
      new FailingNestedWithoutAwaitSideEffectGreeter(123),
      [
        startMessage(),
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

describe("FailingOneWayCallInSideEffectGreeter", () => {
  it("fails on invalid operation oneWayCall in sideEffect", async () => {
    const result = await new TestDriver(
      new FailingOneWayCallInSideEffectGreeter(123),
      [startMessage(), inputMessage(greetRequest("Till")), completionMessage(1)]
    ).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "You cannot do oneWayCall calls from within a side effect"
    );
  });
});

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

describe("FailingCompleteAwakeableSideEffectGreeter", () => {
  it("fails on invalid operation completeAwakeable in sideEffect", async () => {
    const result = await new TestDriver(
      new FailingCompleteAwakeableSideEffectGreeter(123),
      [startMessage(), inputMessage(greetRequest("Till")), completionMessage(1)]
    ).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "You cannot do completeAwakeable calls from within a side effect."
    );
  });
});

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

describe("FailingSleepSideEffectGreeter", () => {
  it("fails on invalid operation sleep in sideEffect", async () => {
    const result = await new TestDriver(
      new FailingSleepSideEffectGreeter(123),
      [startMessage(), inputMessage(greetRequest("Till")), completionMessage(1)]
    ).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "You cannot do sleep calls from within a side effect."
    );
  });
});

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

describe("FailingAwakeableSideEffectGreeter", () => {
  it("fails on invalid operation awakeable in sideEffect", async () => {
    const result = await new TestDriver(
      new FailingAwakeableSideEffectGreeter(123),
      [startMessage(), inputMessage(greetRequest("Till")), completionMessage(1)]
    ).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "You cannot do awakeable calls from within a side effect."
    );
  });
});

export class AwaitSideEffectService implements TestGreeter {

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    let invocationCount = 0;

    await ctx.sideEffect<void>(async () => {
      invocationCount++;
      rlog.debug(invocationCount);
    });
    await ctx.sideEffect<void>(async () => {
      invocationCount++;
      rlog.debug(invocationCount);
    });
    await ctx.sideEffect<void>(async () => {
      invocationCount++;
      rlog.debug(invocationCount);
    });

    return { greeting: invocationCount.toString() };
  }
}

describe("AwaitSideEffectService", () => {
  it("handles completion of all side effects", async () => {
    const result = await new TestDriver(new AwaitSideEffectService(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      completionMessage(1),
      completionMessage(2),
      completionMessage(3),
    ]).run();

    expect(result).toStrictEqual([
      sideEffectMessage(),
      sideEffectMessage(),
      sideEffectMessage(),
      outputMessage(greetResponse("3")),
    ]);
  });

  it("handles replay of first side effect and completion of the others", async () => {
    const result = await new TestDriver(new AwaitSideEffectService(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      sideEffectMessage(),
      completionMessage(2),
      completionMessage(3),
    ]).run();

    expect(result).toStrictEqual([
      sideEffectMessage(),
      sideEffectMessage(),
      outputMessage(greetResponse("2")),
    ]);
  });

  it("handles replay of first two side effect and completion of the other", async () => {
    const result = await new TestDriver(new AwaitSideEffectService(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      sideEffectMessage(),
      sideEffectMessage(),
      completionMessage(3),
    ]).run();

    expect(result).toStrictEqual([
      sideEffectMessage(),
      outputMessage(greetResponse("1")),
    ]);
  });

  it("handles replay of all side effects", async () => {
    const result = await new TestDriver(new AwaitSideEffectService(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      sideEffectMessage(),
      sideEffectMessage(),
      sideEffectMessage(),
    ]).run();

    expect(result).toStrictEqual([outputMessage(greetResponse("0"))]);
  });
});
