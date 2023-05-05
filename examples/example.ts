import * as restate from "../src/public_api";
import {
  TestRequest,
  TestResponse,
  TestGreeter,
  protoMetadata,
} from "../src/generated/proto/test";

/**
 * Example of a service implemented with the Restate Typescript SDK
 * This is a long-running service with two gRPC methods: Greet and MultiWord
 */
export class GreeterService implements TestGreeter {
  async greet(request: TestRequest): Promise<TestResponse> {
    return TestResponse.create({ greeting: `Hello ${request.name}` });
  }

  async multiWord(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    // state
    console.info("Getting the state");
    let seen = (await ctx.get<number>("seen")) || 0;
    seen += 1;

    await ctx.set("seen", seen);

    // return the final response
    return TestResponse.create({
      greeting: `YAGM (yet another greeting method) ${request.name}!`,
    });
  }
}

restate
  .createServer()
  .bindService({
    descriptor: protoMetadata,
    service: "TestGreeter",
    instance: new GreeterService(),
  })
  .listen(8000);
