import { describe, expect } from "@jest/globals";
import * as restate from "../src/public_api";
import { TestDriver } from "./testdriver";
import {
  awakeableMessage,
  checkError,
  checkJournalMismatchError,
  completeAwakeableMessage,
  completionMessage,
  failure,
  getAwakeableId,
  greetRequest,
  greetResponse,
  inputMessage,
  outputMessage,
  startMessage,
  suspensionMessage,
} from "./protoutils";
import { TestGreeter, TestResponse } from "../src/generated/proto/test";
import { ProtocolMode } from "../src/generated/proto/discovery";

class AwakeableGreeter implements TestGreeter {
  async greet(): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    const awakeable = ctx.awakeable<string>();

    const result = await awakeable.promise;

    return TestResponse.create({
      greeting: `Hello ${result} for ${awakeable.id}`,
    });
  }
}

describe("AwakeableGreeter", () => {
  it("sends message to runtime", async () => {
    const result = await new TestDriver(new AwakeableGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
    ]).run();

    expect(result).toStrictEqual([awakeableMessage(), suspensionMessage([1])]);
  });

  it("sends message to runtime for request-response case", async () => {
    const result = await new TestDriver(
      new AwakeableGreeter(),
      [startMessage(1), inputMessage(greetRequest("Till"))],
      ProtocolMode.REQUEST_RESPONSE
    ).run();

    expect(result).toStrictEqual([awakeableMessage(), suspensionMessage([1])]);
  });

  it("handles completion with value", async () => {
    const result = await new TestDriver(new AwakeableGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      completionMessage(1, JSON.stringify("Francesco")),
    ]).run();

    expect(result).toStrictEqual([
      awakeableMessage(),
      outputMessage(greetResponse(`Hello Francesco for ${getAwakeableId(1)}`)),
    ]);
  });

  it("handles completion with empty string value", async () => {
    const result = await new TestDriver(new AwakeableGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      completionMessage(1, JSON.stringify("")),
    ]).run();

    expect(result).toStrictEqual([
      awakeableMessage(),
      outputMessage(greetResponse(`Hello  for ${getAwakeableId(1)}`)),
    ]);
  });

  it("handles completion with empty object value", async () => {
    const result = await new TestDriver(new AwakeableGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      completionMessage(1, JSON.stringify({})),
    ]).run();

    expect(result).toStrictEqual([
      awakeableMessage(),
      outputMessage(
        greetResponse(`Hello [object Object] for ${getAwakeableId(1)}`)
      ),
    ]);
  });

  it("handles completion with failure", async () => {
    const result = await new TestDriver(new AwakeableGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      completionMessage(
        1,
        undefined,
        undefined,
        failure("Something went wrong")
      ),
    ]).run();

    expect(result.length).toStrictEqual(2);
    expect(result[0]).toStrictEqual(awakeableMessage());
    checkError(result[1], "Something went wrong");
  });

  it("handles replay with value", async () => {
    const result = await new TestDriver(new AwakeableGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      awakeableMessage("Francesco"),
    ]).run();

    expect(result).toStrictEqual([
      outputMessage(greetResponse(`Hello Francesco for ${getAwakeableId(1)}`)),
    ]);
  });

  it("handles replay with failure", async () => {
    const result = await new TestDriver(new AwakeableGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      awakeableMessage(undefined, failure("Something went wrong")),
    ]).run();

    expect(result.length).toStrictEqual(1);
    checkError(result[0], "Something went wrong");
  });

  it("fails on journal mismatch. Completed with CompleteAwakeable during replay.", async () => {
    const result = await new TestDriver(new AwakeableGreeter(), [
      startMessage(),
      inputMessage(greetRequest("Till")),
      completeAwakeableMessage(
        "TestGreeter",
        Buffer.from("123"),
        Buffer.from("abcd"),
        1,
        "hello"
      ), // should have been an awakeableMessage
    ]).run();

    expect(result.length).toStrictEqual(1);
    checkJournalMismatchError(result[0]);
  });
});
