import * as restate from "../src/public_api";
import {
  TestRequest,
  TestResponse,
  TestGreeter,
  protoMetadata,
} from "../src/generated/proto/test";

/**
 * Example of a Lambda function implemented with the Restate Typescript SDK
 * This is a Lambda function that can execute two gRPC methods: Greet and MultiWord
 * The only difference with the long-running implementation is in the handler
 * that is exported at the end of this file.
 */
export class GreeterService implements TestGreeter {
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    // state
    let seen = (await ctx.get<number>("seen")) || 0;
    seen += 1;

    await ctx.set("seen", seen);

    // return the final response
    return TestResponse.create({
      greeting: `Hello ${request.name}!`,
    });
  }
}

export const handler = restate
  .lambdaApiGatewayHandler()
  .bindService({
    descriptor: protoMetadata,
    service: "TestGreeter",
    instance: new GreeterService(),
  })
  .create();
