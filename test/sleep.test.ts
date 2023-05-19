import { describe, expect } from "@jest/globals";
import * as restate from "../src/public_api";
import { TestDriver } from "./testdriver";
import {
  awakeableMessage,
  checkError,
  completionMessage,
  greetRequest,
  greetResponse,
  inputMessage,
  outputMessage,
  printResults,
  setStateMessage,
  sleepMessage,
  startMessage,
  suspensionMessage,
} from "./protoutils";
import { SLEEP_ENTRY_MESSAGE_TYPE } from "../src/types/protocol";
import { Empty } from "../src/generated/google/protobuf/empty";
import {
  protoMetadata,
  TestGreeter,
  TestRequest,
  TestResponse,
} from "../src/generated/proto/test";
import { ProtocolMode } from "../src/generated/proto/discovery";

const wakeupTime = 1835661783000;

class SleepGreeter implements TestGreeter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    await ctx.sleep(wakeupTime - Date.now());

    return TestResponse.create({ greeting: `Hello` });
  }
}

class ManySleepsGreeter implements TestGreeter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    await Promise.all(
      Array.from(Array(5).keys()).map(() => ctx.sleep(wakeupTime - Date.now()))
    );

    return TestResponse.create({ greeting: `Hello` });
  }
}

class ManySleepsAndSetGreeter implements TestGreeter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    const mySleeps = Promise.all(
      Array.from(Array(5).keys()).map(() => ctx.sleep(wakeupTime - Date.now()))
    );
    ctx.set("state", "Hello");
    await mySleeps;

    return TestResponse.create({ greeting: `Hello` });
  }
}

describe("SleepGreeter: With sleep not complete", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new SleepGreeter(),
      "/test.TestGreeter/Greet",
      [startMessage(1), inputMessage(greetRequest("Till"))]
    ).run();

    expect(result[0].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result[1]).toStrictEqual(suspensionMessage([1]));
  });
});

describe("SleepGreeter: With replayed incomplete sleep", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new SleepGreeter(),
      "/test.TestGreeter/Greet",
      [startMessage(2), inputMessage(greetRequest("Till")), sleepMessage(1000)]
    ).run();

    expect(result[0]).toStrictEqual(suspensionMessage([1]));
  });
});

describe("SleepGreeter: Request-response with sleep not complete", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new SleepGreeter(),
      "/test.TestGreeter/Greet",
      [startMessage(1), inputMessage(greetRequest("Till"))],
      ProtocolMode.REQUEST_RESPONSE
    ).run();

    expect(result[0].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result[1]).toStrictEqual(suspensionMessage([1]));
  });
});

describe("SleepGreeter: With sleep already complete", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new SleepGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(1, Empty.encode(Empty.create({})).finish()),
      ]
    ).run();

    expect(result[0].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result[1]).toStrictEqual(outputMessage(greetResponse("Hello")));
  });
});

describe("SleepGreeter: With sleep replayed", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new SleepGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(2),
        inputMessage(greetRequest("Till")),
        sleepMessage(wakeupTime, Empty.create({})),
      ]
    ).run();

    expect(result[0]).toStrictEqual(outputMessage(greetResponse("Hello")));
  });
});

describe("SleepGreeter: journal mismatch checks on sleep: Completed with awakeable on replay.", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new SleepGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(2),
        inputMessage(greetRequest("Till")),
        awakeableMessage(""), // should have been a sleep message
      ]
    ).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "Replayed journal entries did not correspond to the user code. The user code has to be deterministic!"
    );
  });
});

describe("ManySleepsGreeter: With sleep not complete", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new ManySleepsGreeter(),
      "/test.TestGreeter/Greet",
      [startMessage(1), inputMessage(greetRequest("Till"))]
    ).run();

    expect(result[0].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result[1].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result[2].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result[3].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result[4].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result[5]).toStrictEqual(suspensionMessage([1, 2, 3, 4, 5]));
  });
});

describe("ManySleepsGreeter: With some sleeps completed without result", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new ManySleepsGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(4),
        completionMessage(2),
      ]
    ).run();

    expect(result[0].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result[1].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result[2].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result[3].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result[4].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result[5]).toStrictEqual(suspensionMessage([1, 2, 3, 4, 5]));
  });
});

describe("ManySleepsGreeter: With some sleeps completed with result", () => {
  it("should call greet", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new ManySleepsGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(1),
        inputMessage(greetRequest("Till")),
        completionMessage(4, undefined, true),
        completionMessage(2, undefined, true),
      ]
    ).run();

    expect(result[0].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result[1].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result[2].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result[3].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result[4].messageType).toStrictEqual(SLEEP_ENTRY_MESSAGE_TYPE);
    expect(result[5]).toStrictEqual(suspensionMessage([1, 3, 5]));
  });
});

describe("ManySleepsGreeter: With all sleeps replayed incomplete", () => {
  it("should send back suspension message", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new ManySleepsGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(6),
        inputMessage(greetRequest("Till")),
        sleepMessage(100),
        sleepMessage(100),
        sleepMessage(100),
        sleepMessage(100),
        sleepMessage(100),
      ]
    ).run();

    expect(result[0]).toStrictEqual(suspensionMessage([1, 2, 3, 4, 5]));
  });
});

describe("ManySleepsGreeter: With all sleeps replayed incomplete+complete", () => {
  it("should send back suspension message", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new ManySleepsGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(6),
        inputMessage(greetRequest("Till")),
        sleepMessage(100),
        sleepMessage(100, Empty.create({})),
        sleepMessage(100),
        sleepMessage(100, Empty.create({})),
        sleepMessage(100),
      ]
    ).run();

    expect(result[0]).toStrictEqual(suspensionMessage([1, 3, 5]));
  });
});

describe("ManySleepsGreeter: With all sleeps replayed complete", () => {
  it("should send back suspension message", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new ManySleepsGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(6),
        inputMessage(greetRequest("Till")),
        sleepMessage(100, Empty.create({})),
        sleepMessage(100, Empty.create({})),
        sleepMessage(100, Empty.create({})),
        sleepMessage(100, Empty.create({})),
        sleepMessage(100, Empty.create({})),
      ]
    ).run();

    expect(result[0]).toStrictEqual(outputMessage(greetResponse("Hello")));
  });
});

describe("ManySleepsAndSetGreeter: With all sleeps replayed complete", () => {
  it("should send back suspension message", async () => {
    const result = await new TestDriver(
      protoMetadata,
      "TestGreeter",
      new ManySleepsAndSetGreeter(),
      "/test.TestGreeter/Greet",
      [
        startMessage(6),
        inputMessage(greetRequest("Till")),
        sleepMessage(100),
        sleepMessage(100),
        sleepMessage(100),
        sleepMessage(100),
        sleepMessage(100),
      ]
    ).run();

    printResults(result);
    expect(result[0]).toStrictEqual(setStateMessage("state", "Hello"));
    expect(result[1]).toStrictEqual(suspensionMessage([1, 2, 3, 4, 5]));
  });
});
