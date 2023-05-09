import { describe } from "@jest/globals";
import { TestDriver } from "./testdriver";
import {
  protoMetadata,
  TestGreeter,
  TestRequest,
  TestResponse,
} from "../src/generated/proto/test";
import { greetRequest, inputMessage, startMessage } from "./protoutils";
import { ProtocolMode } from "../src/generated/proto/discovery";

class SomeTestGreeter implements TestGreeter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async greet(request: TestRequest): Promise<TestResponse> {
    return TestResponse.create({ greeting: `Hello!` });
  }
}
describe("State machine: unkown protocol mode", () => {
  it("should throw", async () => {
    await expect(async () => {
      await new TestDriver(
        protoMetadata,
        "TestGreeter",
        new SomeTestGreeter(),
        "/test.TestGreeter/Greet",
        [startMessage(2), inputMessage(greetRequest("Till"))],
        ProtocolMode.UNRECOGNIZED
      ).run();
    }).rejects.toThrow(
      "Unknown protocol mode. Protocol mode does not have suspension triggers defined."
    );
  });
});
