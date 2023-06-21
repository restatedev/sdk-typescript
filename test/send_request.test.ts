import { describe, expect } from "@jest/globals";
import * as restate from "../src/public_api";
import { TestDriver } from "./testdriver";
import {
  backgroundInvokeMessage,
  checkError,
  completionMessage,
  failure,
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
  TestGreeter,
  TestGreeterClientImpl,
  TestRequest,
  TestResponse,
} from "../src/generated/proto/test";
import { ProtocolMode } from "../src/generated/proto/discovery";
import {
  BackgroundInvokeEntryMessage,
  Failure,
} from "../src/generated/proto/protocol";
import { BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE } from "../src/types/protocol";

class SyncCallGreeter implements TestGreeter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    const client = new TestGreeterClientImpl(ctx);
    const response = await client.greet(
      TestRequest.create({ name: "Francesco" })
    );

    return response;
  }
}

describe("SyncCallGreeter", () => {
  it("sends message to runtime", async () => {
    const result = await new TestDriver(new SyncCallGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
    ]).run();

    expect(result).toStrictEqual([
      invokeMessage("test.TestGreeter", "Greet", greetRequest("Francesco")),
      suspensionMessage([1]),
    ]);
  });

  it("handles completion with value", async () => {
    const result = await new TestDriver(new SyncCallGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      completionMessage(1, greetResponse("Pete")),
    ]).run();

    expect(result).toStrictEqual([
      invokeMessage("test.TestGreeter", "Greet", greetRequest("Francesco")),
      outputMessage(greetResponse("Pete")),
    ]);
  });

  it("handles completion with failure", async () => {
    const result = await new TestDriver(new SyncCallGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      completionMessage(
        1,
        undefined,
        undefined,
        failure(13, "Something went wrong")
      ),
    ]).run();

    expect(result[0]).toStrictEqual(
      invokeMessage("test.TestGreeter", "Greet", greetRequest("Francesco"))
    );
    checkError(result[1], "Something went wrong");
  });

  it("handles replay with value", async () => {
    const result = await new TestDriver(new SyncCallGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      invokeMessage(
        "test.TestGreeter",
        "Greet",
        greetRequest("Francesco"),
        greetResponse("Pete")
      ),
    ]).run();

    expect(result).toStrictEqual([outputMessage(greetResponse("Pete"))]);
  });

  it("handles replay without value", async () => {
    const result = await new TestDriver(new SyncCallGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      invokeMessage("test.TestGreeter", "Greet", greetRequest("Francesco")),
    ]).run();

    expect(result).toStrictEqual([suspensionMessage([1])]);
  });

  it("handles replay with failure", async () => {
    const result = await new TestDriver(new SyncCallGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      completionMessage(
        1,
        undefined,
        undefined,
        failure(13, "Something went wrong")
      ),
    ]).run();

    expect(result[0]).toStrictEqual(
      invokeMessage("test.TestGreeter", "Greet", greetRequest("Francesco"))
    );
    checkError(result[1], "Something went wrong");
  });
});

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

describe("ReverseAwaitOrder", () => {
  it("sends message to runtime", async () => {
    const result = await new TestDriver(new ReverseAwaitOrder(), [
      startMessage(1),
      inputMessage(greetRequest("Till")),
    ]).run();

    expect(result).toStrictEqual([
      invokeMessage("test.TestGreeter", "Greet", greetRequest("Francesco")),
      invokeMessage("test.TestGreeter", "Greet", greetRequest("Till")),
      suspensionMessage([1, 2]),
    ]);
  });

  it("sends message to runtime for request-response mode", async () => {
    const result = await new TestDriver(
      new ReverseAwaitOrder(),
      [startMessage(1), inputMessage(greetRequest("Till"))],
      ProtocolMode.REQUEST_RESPONSE
    ).run();

    expect(result).toStrictEqual([
      invokeMessage("test.TestGreeter", "Greet", greetRequest("Francesco")),
      invokeMessage("test.TestGreeter", "Greet", greetRequest("Till")),
      suspensionMessage([1, 2]),
    ]);
  });

  it("handles completion with value A1 and then A2", async () => {
    const result = await new TestDriver(new ReverseAwaitOrder(), [
      startMessage(1),
      inputMessage(greetRequest("Till")),
      completionMessage(1, greetResponse("FRANCESCO")),
      completionMessage(2, greetResponse("TILL")),
    ]).run();

    expect(result).toStrictEqual([
      invokeMessage("test.TestGreeter", "Greet", greetRequest("Francesco")),
      invokeMessage("test.TestGreeter", "Greet", greetRequest("Till")),
      setStateMessage("A2", "TILL"),
      outputMessage(greetResponse("Hello FRANCESCO-TILL")),
    ]);
  });

  it("handles completion with value A2 and then A1", async () => {
    const result = await new TestDriver(new ReverseAwaitOrder(), [
      startMessage(1),
      inputMessage(greetRequest("Till")),
      completionMessage(2, greetResponse("TILL")),
      completionMessage(1, greetResponse("FRANCESCO")),
    ]).run();

    expect(result).toStrictEqual([
      invokeMessage("test.TestGreeter", "Greet", greetRequest("Francesco")),
      invokeMessage("test.TestGreeter", "Greet", greetRequest("Till")),
      setStateMessage("A2", "TILL"),
      outputMessage(greetResponse("Hello FRANCESCO-TILL")),
    ]);
  });

  it("handles replay with value for A1 and A2", async () => {
    const result = await new TestDriver(new ReverseAwaitOrder(), [
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
    ]).run();

    expect(result).toStrictEqual([
      outputMessage(greetResponse("Hello FRANCESCO-TILL")),
    ]);
  });

  it("fails on journal mismatch. A1 completed with wrong service name", async () => {
    const result = await new TestDriver(new ReverseAwaitOrder(), [
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
    ]).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "Replayed journal entries did not correspond to the user code. The user code has to be deterministic!"
    );
  });

  it("fails on journal mismatch. A1 completed with wrong method name.", async () => {
    const result = await new TestDriver(new ReverseAwaitOrder(), [
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
    ]).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "Replayed journal entries did not correspond to the user code. The user code has to be deterministic!"
    );
  });

  it("fails on journal mismatch. A1 completed with wrong request", async () => {
    const result = await new TestDriver(new ReverseAwaitOrder(), [
      startMessage(4),
      inputMessage(greetRequest("Till")),
      invokeMessage(
        "test.TestGreeter",
        "Greet",
        greetRequest("AnotherName"), // should have been Francesco
        greetResponse("FRANCESCO")
      ),
      invokeMessage(
        "test.TestGreeter",
        "Greet",
        greetRequest("Till"),
        greetResponse("TILL")
      ),
      setStateMessage("A2", "TILL"),
    ]).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "Replayed journal entries did not correspond to the user code. The user code has to be deterministic!"
    );
  });

  it("fails on journal mismatch. A2 completed with backgroundInvoke", async () => {
    const result = await new TestDriver(new ReverseAwaitOrder(), [
      startMessage(4),
      inputMessage(greetRequest("Till")),
      invokeMessage(
        "test.TestGreeter",
        "Greet",
        greetRequest("Francesco"),
        greetResponse("FRANCESCO")
      ),
      backgroundInvokeMessage(
        "test.TestGreeter",
        "Greet",
        greetRequest("Till")
      ), // should have been an invoke message
      setStateMessage("A2", "TILL"),
    ]).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "Replayed journal entries did not correspond to the user code. The user code has to be deterministic!"
    );
  });

  //TODO
  /*
Late completions after the state machine has been closed lead to weird behavior
The following happens:
The service: ReverseAwaitOrder
gets completed in this order: (test: https://github.com/restatedev/sdk-typescript/blob/96cacb7367bc521c19d65592b27ce50dea406659/test/send_request.test.ts#L348)
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(
          1,
          undefined,
          undefined,
          Failure.create({ code: 13, message: "Error" })
        ),
        completionMessage(2, greetResponse("TILL")),
The current behaviour is that the first completion (error) throws a user-code error that isn't catched. So the entire call fails and sends back an output entry stream message.
But then the completion of the other call comes in. This can happen in the case where the runtime didn't yet see the output message before sending the completion.
This gives the following error:
(node:15318) PromiseRejectionHandledWarning: Promise rejection was handled asynchronously (rejection id: 2)
    at handledRejection (node:internal/process/promises:172:23)
    at promiseRejectHandler (node:internal/process/promises:118:7)
    at ReverseAwaitOrder.greet (/home/giselle/dev/sdk-typescript/test/send_request.test.ts:41:23)
    at GrpcServiceMethod.localMethod [as localFn] (/home/giselle/dev/sdk-typescript/src/server/base_restate_server.ts:201:16)
 */
  //   it("handles completion with failure", async () => {
  //     const result = await new TestDriver(
  //       new ReverseAwaitOrder(),
  //       [
  //         startMessage(1),
  //         inputMessage(greetRequest("Till")),
  //         completionMessage(
  //           1,
  //           undefined,
  //           undefined,
  //           Failure.create({ code: 13, message: "Error" })
  //         ),
  //         completionMessage(2, greetResponse("TILL")),
  //       ]
  //     ).run();
  //
  //     expect(result.length).toStrictEqual(4);
  //     expect(result[0]).toStrictEqual(
  //       invokeMessage("test.TestGreeter", "Greet", greetRequest("Francesco"))
  //     );
  //     expect(result[1]).toStrictEqual(
  //       invokeMessage("test.TestGreeter", "Greet", greetRequest("Till"))
  //     );
  //     expect(result[2]).toStrictEqual(setStateMessage("A2", "TILL"));
  //     checkError(result[3], "Error"); // Error comes from the failed completion
  //   });
  //
});

class FailingForwardGreetingService implements TestGreeter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    const client = new TestGreeterClientImpl(ctx);

    try {
      // This will get an failure back as a completion or replay message
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const greeting = await client.greet(
        TestRequest.create({ name: "Francesco" })
      );
    } catch (error) {
      if (error instanceof Error) {
        // If we call another service and get back a failure.
        // The failure should be thrown in the user code.
        return TestResponse.create({
          greeting: `Hello ${error.message}`,
        });
      }
      throw new Error("Error is not instanceof Error: " + typeof error);
    }

    return TestResponse.create({
      greeting: `Hello, you shouldn't be here...`,
    });
  }
}

describe("FailingForwardGreetingService", () => {
  it("handles completion with failure", async () => {
    const result = await new TestDriver(new FailingForwardGreetingService(), [
      startMessage(1),
      inputMessage(greetRequest("Till")),
      completionMessage(
        1,
        undefined,
        undefined,
        Failure.create({
          code: 13,
          message: "Sorry, something went terribly wrong...",
        })
      ),
    ]).run();

    expect(result).toStrictEqual([
      invokeMessage("test.TestGreeter", "Greet", greetRequest("Francesco")),
      outputMessage(
        greetResponse("Hello Sorry, something went terribly wrong...")
      ),
    ]);
  });

  it("handles replay with failure", async () => {
    const result = await new TestDriver(new FailingForwardGreetingService(), [
      startMessage(2),
      inputMessage(greetRequest("Till")),
      invokeMessage(
        "test.TestGreeter",
        "Greet",
        greetRequest("Francesco"),
        undefined,
        Failure.create({
          code: 13,
          message: "Sorry, something went terribly wrong...",
        })
      ),
    ]).run();

    expect(result).toStrictEqual([
      outputMessage(
        greetResponse("Hello Sorry, something went terribly wrong...")
      ),
    ]);
  });
});

class OneWayCallGreeter implements TestGreeter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    const client = new TestGreeterClientImpl(ctx);
    await ctx.oneWayCall(() =>
      client.greet(TestRequest.create({ name: "Francesco" }))
    );

    return TestResponse.create({ greeting: `Hello` });
  }
}

describe("OneWayCallGreeter", () => {
  it("sends message to runtime", async () => {
    const result = await new TestDriver(new OneWayCallGreeter(), [
      startMessage(1),
      inputMessage(greetRequest("Till")),
    ]).run();

    expect(result).toStrictEqual([
      backgroundInvokeMessage(
        "test.TestGreeter",
        "Greet",
        greetRequest("Francesco")
      ),
      outputMessage(greetResponse("Hello")),
    ]);
  });

  it("fails on journal mismatch. Completed with invoke", async () => {
    const result = await new TestDriver(new OneWayCallGreeter(), [
      startMessage(2),
      inputMessage(greetRequest("Till")),
      invokeMessage("test.TestGreeter", "Greet", greetRequest("Francesco")), // should have been BackgroundInvoke
    ]).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "Replayed journal entries did not correspond to the user code. The user code has to be deterministic!"
    );
  });

  it("fails on journal mismatch. Completed with different service name.", async () => {
    const result = await new TestDriver(new OneWayCallGreeter(), [
      startMessage(2),
      inputMessage(greetRequest("Till")),
      backgroundInvokeMessage(
        "test.TestGreeterWrong", // should have been "test.TestGreeter"
        "Greet",
        greetRequest("Francesco")
      ),
    ]).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "Replayed journal entries did not correspond to the user code. The user code has to be deterministic!"
    );
  });

  it("fails on journal mismatch. Completed with different method", async () => {
    const result = await new TestDriver(new OneWayCallGreeter(), [
      startMessage(2),
      inputMessage(greetRequest("Till")),
      backgroundInvokeMessage(
        "test.TestGreeter",
        "Greetzzz", // should have been "Greet"
        greetRequest("Francesco")
      ),
    ]).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "Replayed journal entries did not correspond to the user code. The user code has to be deterministic!"
    );
  });

  it("fails on journal mismatch. Completed with different request.", async () => {
    const result = await new TestDriver(new OneWayCallGreeter(), [
      startMessage(2),
      inputMessage(greetRequest("Till")),
      backgroundInvokeMessage(
        "test.TestGreeter",
        "Greet",
        greetRequest("AnotherName") // should have been "Francesco"
      ),
    ]).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "Replayed journal entries did not correspond to the user code. The user code has to be deterministic!"
    );
  });
});

class FailingOneWayCallGreeter implements TestGreeter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    await ctx.oneWayCall(async () => ctx.set("state", 13));

    return TestResponse.create({ greeting: `Hello` });
  }
}

describe("FailingOneWayCallGreeter", () => {
  it("fails on illegal operation set state in oneWayCall", async () => {
    const result = await new TestDriver(new FailingOneWayCallGreeter(), [
      startMessage(1),
      inputMessage(greetRequest("Till")),
    ]).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "Cannot do a set state from within ctx.oneWayCall(...)."
    );
  });
});

class FailingAwakeableOneWayCallGreeter implements TestGreeter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    await ctx.oneWayCall(async () => ctx.awakeable<string>());

    return TestResponse.create({ greeting: `Hello` });
  }
}

describe("FailingAwakeableOneWayCallGreeter", () => {
  it("fails on illegal operation awakeable in oneWayCall", async () => {
    const result = await new TestDriver(
      new FailingAwakeableOneWayCallGreeter(),
      [startMessage(1), inputMessage(greetRequest("Till"))]
    ).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "Cannot do a awakeable from within ctx.oneWayCall(...)."
    );
  });
});

class FailingSideEffectInOneWayCallGreeter implements TestGreeter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    await ctx.oneWayCall(async () => ctx.sideEffect(async () => 13));

    return TestResponse.create({ greeting: `Hello` });
  }
}

describe("FailingSideEffectInOneWayCallGreeter", () => {
  it("fails on illegal operation sideEffect in oneWayCall", async () => {
    const result = await new TestDriver(
      new FailingSideEffectInOneWayCallGreeter(),
      [startMessage(1), inputMessage(greetRequest("Till"))]
    ).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "Cannot do a side effect from within ctx.oneWayCall(...). Context method ctx.oneWayCall() can only be used to invoke other services unidirectionally. e.g. ctx.oneWayCall(() => client.greet(my_request))"
    );
  });
});

class CatchTwoFailingInvokeGreeter implements TestGreeter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    // Do a failing async call
    try {
      await ctx.oneWayCall(async () => {
        throw new Error("This fails.");
      });
    } catch (e) {
      // do nothing
    }

    // Do a succeeding async call
    const client = new TestGreeterClientImpl(ctx);
    await ctx.oneWayCall(() =>
      client.greet(TestRequest.create({ name: "Pete" }))
    );

    return TestResponse.create({ greeting: `Hello` });
  }
}

describe("CatchTwoFailingInvokeGreeter", () => {
  it("catches the failed oneWayCall", async () => {
    const result = await new TestDriver(new CatchTwoFailingInvokeGreeter(), [
      startMessage(1),
      inputMessage(greetRequest("Till")),
    ]).run();

    expect(result.length).toStrictEqual(2);
    expect(result).toStrictEqual([
      backgroundInvokeMessage(
        "test.TestGreeter",
        "Greet",
        greetRequest("Pete"),
        undefined
      ),
      outputMessage(greetResponse("Hello")),
    ]);
  });
});

const delayedCallTime = 1835661783000;
class DelayedOneWayCallGreeter implements TestGreeter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    const client = new TestGreeterClientImpl(ctx);
    await ctx.delayedCall(
      () => client.greet(TestRequest.create({ name: "Francesco" })),
      delayedCallTime - Date.now()
    );

    return TestResponse.create({ greeting: `Hello` });
  }
}

describe("DelayedOneWayCallGreeter", () => {
  it("sends message to runtime", async () => {
    const result = await new TestDriver(new DelayedOneWayCallGreeter(), [
      startMessage(1),
      inputMessage(greetRequest("Till")),
    ]).run();

    // Delayed call time is slightly larger or smaller based on test execution speed... So test the range
    expect(result[0].messageType).toStrictEqual(
      BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE
    );
    const msg = result[0].message as BackgroundInvokeEntryMessage;
    expect(msg.serviceName).toStrictEqual("test.TestGreeter");
    expect(msg.methodName).toStrictEqual("Greet");
    expect(msg.parameter.toString().trim()).toStrictEqual("Francesco");
    expect(msg.invokeTime).toBeGreaterThanOrEqual(delayedCallTime);
    expect(msg.invokeTime).toBeLessThanOrEqual(delayedCallTime + 10);
    expect(result[1]).toStrictEqual(outputMessage(greetResponse("Hello")));
  });

  it("handles replay", async () => {
    const result = await new TestDriver(new DelayedOneWayCallGreeter(), [
      startMessage(2),
      inputMessage(greetRequest("Till")),
      backgroundInvokeMessage(
        "test.TestGreeter",
        "Greet",
        greetRequest("Francesco"),
        delayedCallTime
      ),
    ]).run();

    expect(result).toStrictEqual([outputMessage(greetResponse("Hello"))]);
  });

  it("fails on journal mismatch. Completed with InvokeMessage.", async () => {
    const result = await new TestDriver(new DelayedOneWayCallGreeter(), [
      startMessage(2),
      inputMessage(greetRequest("Till")),
      invokeMessage("test.TestGreeter", "Greet", greetRequest("Francesco")),
    ]).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "Replayed journal entries did not correspond to the user code. The user code has to be deterministic!"
    );
  });
});

class DelayedAndNormalInOneWayCallGreeter implements TestGreeter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    const client = new TestGreeterClientImpl(ctx);
    await ctx.delayedCall(
      () => client.greet(TestRequest.create({ name: "Francesco" })),
      delayedCallTime - Date.now()
    );
    await ctx.oneWayCall(() =>
      client.greet(TestRequest.create({ name: "Francesco" }))
    );

    return TestResponse.create({ greeting: `Hello` });
  }
}

describe("DelayedAndNormalInOneWayCallGreeter", () => {
  it("sends delayed and normal oneWayCall to runtime", async () => {
    const result = await new TestDriver(
      new DelayedAndNormalInOneWayCallGreeter(),
      [startMessage(1), inputMessage(greetRequest("Till"))]
    ).run();

    expect(result[0].messageType).toStrictEqual(
      BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE
    );
    const msg = result[0].message as BackgroundInvokeEntryMessage;
    expect(msg.serviceName).toStrictEqual("test.TestGreeter");
    expect(msg.methodName).toStrictEqual("Greet");
    expect(msg.parameter.toString().trim()).toStrictEqual("Francesco");
    expect(msg.invokeTime).toBeGreaterThanOrEqual(delayedCallTime);
    expect(msg.invokeTime).toBeLessThanOrEqual(delayedCallTime + 10);
    expect(result[1]).toStrictEqual(
      backgroundInvokeMessage(
        "test.TestGreeter",
        "Greet",
        greetRequest("Francesco")
      )
    );
    expect(result[2]).toStrictEqual(outputMessage(greetResponse("Hello")));
  });
});

class UnawaitedRequestResponseCallGreeter implements TestGreeter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    const client = new TestGreeterClientImpl(ctx);
    client.greet(TestRequest.create({ name: "Francesco" }));

    return TestResponse.create({ greeting: `Hello` });
  }
}

describe("UnawaitedRequestResponseCallGreeter", () => {
  it("does not await the response of the call after journal mismatch checks have been done", async () => {
    const result = await new TestDriver(
      new UnawaitedRequestResponseCallGreeter(),
      [
        startMessage(2),
        inputMessage(greetRequest("Till")),
        invokeMessage("test.TestGreeter", "Greet", greetRequest("Francesco")),
      ]
    ).run();

    expect(result).toStrictEqual([outputMessage(greetResponse("Hello"))]);
  });
});


class DelayedCallInOneWayCall implements TestGreeter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    const client = new TestGreeterClientImpl(ctx);
    await ctx.oneWayCall(async () => {
      return await ctx.delayedCall(() => client.greet(TestRequest.create({ name: "Francesco" })), 5000);
    })

    return TestResponse.create({ greeting: `Hello` });
  }
}

describe("DelayedCallInOneWayCall", () => {
  it("fails on invalid operation delayedCall within oneWayCall", async () => {
    const result = await new TestDriver(
      new DelayedCallInOneWayCall(),
      [
        startMessage(2),
        inputMessage(greetRequest("Till")),
      ]
    ).run();

    checkError(result[0], "Cannot do a delayedCall from within ctx.oneWayCall");
  });
});

class OneWayCallInDelayedCall implements TestGreeter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    const client = new TestGreeterClientImpl(ctx);
    await ctx.delayedCall(async () => {
      return await ctx.oneWayCall(() => client.greet(TestRequest.create({ name: "Francesco" })))
      },
      5000)

    return TestResponse.create({ greeting: `Hello` });
  }
}

describe("OneWayCallInDelayedCall", () => {
  it("fails on invalid operation oneWayCall within delayedCall", async () => {
    const result = await new TestDriver(
      new OneWayCallInDelayedCall(),
      [
        startMessage(2),
        inputMessage(greetRequest("Till")),
      ]
    ).run();

    checkError(result[0], "Cannot do a oneWayCall from within ctx.delayedCall");
  });
});