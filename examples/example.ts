import * as restate from "../src/public_api";
import {
  TestRequest,
  TestResponse,
  TestGreeter,
  protoMetadata,
} from "../src/generated/proto/test";
import { randomInt } from "crypto";
import { TerminalError } from "../src/types/errors";
import { rlog } from "../src/utils/logger";

/**
 * Example of a service implemented with the Restate Typescript SDK
 * This is a long-running service with two gRPC methods: Greet and MultiWord
 */
export class GreeterService implements TestGreeter {
  async greet(request: TestRequest): Promise<TestResponse> {
    const ctx = restate.useContext(this);

    // state
    let seen = (await ctx.get<number>("seen")) || 0;
    seen += 1;
    await ctx.set("seen", seen);

    // try {
    const result = await ctx.sideEffect(async () => {
      /*      const nb = randomInt(5);
              rlog.log(nb);
              if(nb < 2) {*/
      // throw new TerminalError("Execution failed");
      //  } else {
      throw new TerminalError("Execution failed");
      // }
    });
    rlog.info("Result 1: " + result);
    // } catch (e) {
    //   rlog.info("I can catch this");
    // }

    const result2 = await ctx.sideEffect(async () => {
      rlog.info("I am here");
      return 5;
      /*      const nb = randomInt(5);
            rlog.log(nb);
            if(nb < 2) {*/
      // throw new TerminalError("Execution failed");
      //  } else {
      // }
    });
    rlog.info("Result 2: " + result2);

    // return the final response
    return TestResponse.create({
      greeting: `Hello ${request.name} no.${seen}!`,
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
  .listen(8080);
