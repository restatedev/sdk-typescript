import { describe, expect } from "@jest/globals";
import * as restate from "../src/public_api";
import { TestDriver } from "../src/testdriver";
import {
  completionMessage,
  inputMessage,
  outputMessage,
  sideEffectMessage,
  startMessage,
  greetRequest,
  greetResponse,
} from "./protoutils";
import {
  protoMetadata,
  TestGreeter,
  TestRequest,
  TestResponse,
} from "../src/generated/proto/test";
import {
  AwakeableIdentifier,
  SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
} from "../src/types";
import { SideEffectEntryMessage } from "../src/generated/proto/javascript";
import { Failure } from "../src/generated/proto/protocol";

class SideEffectGreeter implements TestGreeter {
  constructor(readonly sideEffectOutput: string) {}

  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    // state
    const response = await ctx.sideEffect(async () => {
      return this.sideEffectOutput;
    });

    return TestResponse.create({ greeting: `Hello ${response}` });
  }
}

class NumericSideEffectGreeter implements TestGreeter {
  constructor(readonly sideEffectOutput: number) {}

  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    // state
    const response = await ctx.sideEffect(async () => {
      return this.sideEffectOutput;
    });

    return TestResponse.create({ greeting: `Hello ${response}` });
  }
}
class FailingSideEffectGreeter implements TestGreeter {
  constructor(readonly sideEffectOutput: number) {}

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

  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    // state
    const response = await ctx.sideEffect(async () => {
      const state = await ctx.get("state");
      return this.sideEffectOutput;
    });

    return TestResponse.create({ greeting: `Hello ${response}` });
  }
}

class FailingSetSideEffectGreeter implements TestGreeter {
  constructor(readonly sideEffectOutput: number) {}

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

  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    // state
    const response = await ctx.sideEffect(async () => {
      ctx.sideEffect(async () => {
        return this.sideEffectOutput;
      });
    });

    return TestResponse.create({ greeting: `Hello ${response}` });
  }
}

class FailingInBackgroundSideEffectGreeter implements TestGreeter {
  constructor(readonly sideEffectOutput: number) {}

  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    // state
    const response = await ctx.sideEffect(async () => {
      await ctx.inBackground(async () => {
        return;
      });
    });

    return TestResponse.create({ greeting: `Hello ${response}` });
  }
}

class FailingSleepSideEffectGreeter implements TestGreeter {
  constructor(readonly sideEffectOutput: number) {}

  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    // state
    const response = await ctx.sideEffect(async () => {
      await ctx.sleep(1000)
    });

    return TestResponse.create({ greeting: `Hello ${response}` });
  }
}

class FailingCompleteAwakeableSideEffectGreeter implements TestGreeter {
  constructor(readonly sideEffectOutput: number) {}

  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    // state
    const response = await ctx.sideEffect(async () => {
      const awakeableIdentifier = new AwakeableIdentifier(
        "TestGreeter",
        Buffer.from("123"),
        Buffer.from("abcd"),
        1
      );
      ctx.completeAwakeable(awakeableIdentifier, "hello");
    });

    return TestResponse.create({ greeting: `Hello ${response}` });
  }
}

describe("SideEffectGreeter: without ack", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new SideEffectGreeter("Francesco"),
      "/dev.restate.TestGreeter/Greet",
      [startMessage(1), inputMessage(greetRequest("Till"))]
    ).run();

    expect(result).toStrictEqual([sideEffectMessage("Francesco")]);
  });
});

describe("SideEffectGreeter: with ack", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new SideEffectGreeter("Francesco"),
      "/dev.restate.TestGreeter/Greet",
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

describe("SideEffectGreeter: with completion", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new SideEffectGreeter("Francesco"),
      "/dev.restate.TestGreeter/Greet",
      [
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(1, "Francesco"),
      ]
    ).run();

    expect(result).toStrictEqual([
      sideEffectMessage("Francesco"),
      outputMessage(greetResponse("Hello Francesco")),
    ]);
  });
});

describe("SideEffectGreeter: without ack - numeric output", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new NumericSideEffectGreeter(123),
      "/dev.restate.TestGreeter/Greet",
      [startMessage(1), inputMessage(greetRequest("Till"))]
    ).run();

    expect(result).toStrictEqual([sideEffectMessage(123)]);
  });
});

describe("FailingSideEffectGreeter: failing user code in side effect without ack", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new FailingSideEffectGreeter(123),
      "/dev.restate.TestGreeter/Greet",
      [startMessage(1), inputMessage(greetRequest("Till"))]
    ).run();

    expect(result.length).toStrictEqual(1);
    expect(result[0].messageType).toStrictEqual(SIDE_EFFECT_ENTRY_MESSAGE_TYPE);
    expect(
      (result[0].message as SideEffectEntryMessage).failure?.code
    ).toStrictEqual(13);
  });
});

describe("FailingGetSideEffectGreeter: invalid get state in side effect without ack", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new FailingGetSideEffectGreeter(123),
      "/dev.restate.TestGreeter/Greet",
      [startMessage(1), inputMessage(greetRequest("Till"))]
    ).run();

    expect(result.length).toStrictEqual(1);
    expect(result[0].messageType).toStrictEqual(SIDE_EFFECT_ENTRY_MESSAGE_TYPE);
    expect(
      (result[0].message as SideEffectEntryMessage).failure?.code
    ).toStrictEqual(13);
  });
});

describe("FailingSetSideEffectGreeter: invalid set state in side effect without ack", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new FailingSetSideEffectGreeter(123),
      "/dev.restate.TestGreeter/Greet",
      [startMessage(1), inputMessage(greetRequest("Till"))]
    ).run();

    expect(result.length).toStrictEqual(1);
    expect(result[0].messageType).toStrictEqual(SIDE_EFFECT_ENTRY_MESSAGE_TYPE);
    expect(
      (result[0].message as SideEffectEntryMessage).failure?.code
    ).toStrictEqual(13);
  });
});

describe("FailingClearSideEffectGreeter: invalid clear state in side effect with ack", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new FailingClearSideEffectGreeter(123),
      "/dev.restate.TestGreeter/Greet",
      [
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(
          1,
          undefined,
          false,
          Failure.create({
            code: 13,
            message:
              "Error: You cannot do clear state calls from within a side effect.",
          })
        ),
      ]
    ).run();

    expect(result.length).toStrictEqual(2);
    expect(result[0].messageType).toStrictEqual(SIDE_EFFECT_ENTRY_MESSAGE_TYPE);
    expect(
      (result[0].message as SideEffectEntryMessage).failure?.code
    ).toStrictEqual(13);
    expect(result[1]).toStrictEqual(outputMessage());
  });
});

describe("FailingNestedSideEffectGreeter: invalid nested side effect in side effect without ack", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new FailingNestedSideEffectGreeter(123),
      "/dev.restate.TestGreeter/Greet",
      [startMessage(1), inputMessage(greetRequest("Till"))]
    ).run();

    expect(result.length).toStrictEqual(1);
    expect(result[0].messageType).toStrictEqual(SIDE_EFFECT_ENTRY_MESSAGE_TYPE);
    expect(
      (result[0].message as SideEffectEntryMessage).failure?.code
    ).toStrictEqual(13);
  });
});

describe("FailingNestedSideEffectGreeter: invalid nested side effect in side effect with ack", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new FailingNestedSideEffectGreeter(123),
      "/dev.restate.TestGreeter/Greet",
      [
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(
          1,
          undefined,
          false,
          Failure.create({
            code: 13,
            message:
              "Error: You cannot do sideEffect state calls from within a side effect.",
          })
        ),
      ]
    ).run();

    expect(result.length).toStrictEqual(2);
    expect(result[0].messageType).toStrictEqual(SIDE_EFFECT_ENTRY_MESSAGE_TYPE);
    expect(
      (result[0].message as SideEffectEntryMessage).failure?.code
    ).toStrictEqual(13);
    expect(result[1]).toStrictEqual(outputMessage());
  });
});

describe("FailingNestedSideEffectGreeter: invalid nested side effect in side effect with replay ack", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new FailingNestedSideEffectGreeter(123),
      "/dev.restate.TestGreeter/Greet",
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
    expect(result).toStrictEqual([outputMessage()]);
  });
});

describe("FailingInBackgroundSideEffectGreeter: invalid in background call in side effect without ack", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new FailingInBackgroundSideEffectGreeter(123),
      "/dev.restate.TestGreeter/Greet",
      [startMessage(1), inputMessage(greetRequest("Till"))]
    ).run();

    expect(result.length).toStrictEqual(1);
    expect(result[0].messageType).toStrictEqual(SIDE_EFFECT_ENTRY_MESSAGE_TYPE);
    expect(
      (result[0].message as SideEffectEntryMessage).failure?.code
    ).toStrictEqual(13);
  });
});

describe("FailingCompleteAwakeableSideEffectGreeter: invalid in complete awakeable call in side effect without ack", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new FailingCompleteAwakeableSideEffectGreeter(123),
      "/dev.restate.TestGreeter/Greet",
      [startMessage(1), inputMessage(greetRequest("Till"))]
    ).run();

    expect(result.length).toStrictEqual(1);
    expect(result[0].messageType).toStrictEqual(SIDE_EFFECT_ENTRY_MESSAGE_TYPE);
    expect(
      (result[0].message as SideEffectEntryMessage).failure?.code
    ).toStrictEqual(13);
  });
});

describe("FailingSleepSideEffectGreeter: invalid in sleep call in side effect without ack", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new FailingSleepSideEffectGreeter(123),
      "/dev.restate.TestGreeter/Greet",
      [startMessage(1), inputMessage(greetRequest("Till"))]
    ).run();

    expect(result.length).toStrictEqual(1);
    expect(result[0].messageType).toStrictEqual(SIDE_EFFECT_ENTRY_MESSAGE_TYPE);
    expect(
      (result[0].message as SideEffectEntryMessage).failure?.code
    ).toStrictEqual(13);
  });
});
