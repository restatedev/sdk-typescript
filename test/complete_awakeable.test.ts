import {
  TestGreeter,
  TestRequest,
  TestResponse,
} from "../src/generated/proto/test";
import * as restate from "../src/public_api";
import {
  checkError,
  completeAwakeableMessage,
  getAwakeableId,
  greetRequest,
  greetResponse,
  inputMessage,
  invokeMessage,
  outputMessage,
  startMessage,
} from "./protoutils";
import { describe, expect } from "@jest/globals";
import { TestDriver } from "./testdriver";

class CompleteAwakeableGreeter implements TestGreeter {
  constructor(readonly payload: string) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    const awakeableIdentifier = getAwakeableId(1);
    ctx.completeAwakeable(awakeableIdentifier, this.payload);

    return TestResponse.create({ greeting: `Hello` });
  }
}

describe("CompleteAwakeableGreeter", () => {
  it("sends message to runtime", async () => {
    const result = await new TestDriver(new CompleteAwakeableGreeter("hello"), [
      startMessage(),
      inputMessage(greetRequest("Till")),
    ]).run();

    expect(result).toStrictEqual([
      completeAwakeableMessage(
        "test.TestGreeter",
        Buffer.from("123"),
        Buffer.from("abcd"),
        1,
        "hello"
      ),
      outputMessage(greetResponse("Hello")),
    ]);
  });

  it("sends message to runtime for empty string", async () => {
    const result = await new TestDriver(new CompleteAwakeableGreeter(""), [
      startMessage(),
      inputMessage(greetRequest("Till")),
    ]).run();

    expect(result).toStrictEqual([
      completeAwakeableMessage(
        "test.TestGreeter",
        Buffer.from("123"),
        Buffer.from("abcd"),
        1,
        ""
      ),
      outputMessage(greetResponse("Hello")),
    ]);
  });

  it("handles replay with value", async () => {
    const result = await new TestDriver(new CompleteAwakeableGreeter("hello"), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      completeAwakeableMessage(
        "test.TestGreeter",
        Buffer.from("123"),
        Buffer.from("abcd"),
        1,
        "hello"
      ),
    ]).run();

    expect(result).toStrictEqual([outputMessage(greetResponse("Hello"))]);
  });

  it("handles replay with value empty string", async () => {
    const result = await new TestDriver(new CompleteAwakeableGreeter(""), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      completeAwakeableMessage(
        "test.TestGreeter",
        Buffer.from("123"),
        Buffer.from("abcd"),
        1,
        ""
      ),
    ]).run();

    expect(result).toStrictEqual([outputMessage(greetResponse("Hello"))]);
  });

  it("fails on journal mismatch. Completed with invoke during replay.", async () => {
    const result = await new TestDriver(new CompleteAwakeableGreeter("hello"), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      invokeMessage(
        "test.TestGreeter",
        "Greet",
        greetRequest("Till"),
        greetResponse("TILL")
      ), // this should have been a completeawakeable
    ]).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "Journal mismatch: Replayed journal entries did not correspond to the user code. The user code has to be deterministic!"
    );
  });

  it("fails on journal mismatch. Completed with wrong service name", async () => {
    const result = await new TestDriver(new CompleteAwakeableGreeter("hello"), [
      startMessage(2),
      inputMessage(greetRequest("Till")),
      completeAwakeableMessage(
        "TestGreeterzzz", // this should have been TestGreeter
        Buffer.from("123"),
        Buffer.from("abcd"),
        1,
        "hello"
      ),
    ]).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "Journal mismatch: Replayed journal entries did not correspond to the user code. The user code has to be deterministic!"
    );
  });

  it("fails on journal mismatch. Completed with wrong instance key.", async () => {
    const result = await new TestDriver(new CompleteAwakeableGreeter("hello"), [
      startMessage(2),
      inputMessage(greetRequest("Till")),
      completeAwakeableMessage(
        "TestGreeter",
        Buffer.from("1234"), // this should have been a Buffer.from("123")
        Buffer.from("abcd"),
        1,
        "hello"
      ),
    ]).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "Journal mismatch: Replayed journal entries did not correspond to the user code. The user code has to be deterministic!"
    );
  });

  it("fails on journal mismatch. Completed with wrong invocation id.", async () => {
    const result = await new TestDriver(new CompleteAwakeableGreeter("hello"), [
      startMessage(2),
      inputMessage(greetRequest("Till")),
      completeAwakeableMessage(
        "TestGreeter",
        Buffer.from("123"),
        Buffer.from("abcde"), // this should have been a Buffer.from("abcd")
        1,
        "hello"
      ),
    ]).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "Journal mismatch: Replayed journal entries did not correspond to the user code. The user code has to be deterministic!"
    );
  });

  it("fails on journal mismatch. Completed with wrong entry index.", async () => {
    const result = await new TestDriver(new CompleteAwakeableGreeter("hello"), [
      startMessage(2),
      inputMessage(greetRequest("Till")),
      completeAwakeableMessage(
        "TestGreeter",
        Buffer.from("123"),
        Buffer.from("abcd"),
        2, // this should have been 1
        "hello"
      ),
    ]).run();

    expect(result.length).toStrictEqual(1);
    checkError(
      result[0],
      "Journal mismatch: Replayed journal entries did not correspond to the user code. The user code has to be deterministic!"
    );
  });
});
