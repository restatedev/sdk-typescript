import * as restate from "../src/public_api";
import {
  GreetRequest,
  GreetResponse,
  Greeter,
  protoMetadata,
} from "../src/generated/proto/example";

/**
 * Example of a service implemented with the Restate Typescript SDK
 * This is a long-running service with two gRPC methods: Greet and MultiWord
 */
export class GreeterService implements Greeter {
  async greet(request: GreetRequest): Promise<GreetResponse> {
    return GreetResponse.create({ greeting: `Hello ${request.name}` });
  }

  async multiWord(request: GreetRequest): Promise<GreetResponse> {
    const ctx = restate.useContext(this);

    // state
    console.log("Getting the state");
    let seen = (await ctx.get<number>("seen")) || 0;
    seen += 1;

    await ctx.set("seen", seen);

    // return the final response
    return GreetResponse.create({
      greeting: `YAGM (yet another greeting method) ${request.name}!`,
    });
  }
}

restate
  .createServer()
  .bindService({
    descriptor: protoMetadata,
    service: "Greeter",
    instance: new GreeterService(),
  })
  .listen(8000);
