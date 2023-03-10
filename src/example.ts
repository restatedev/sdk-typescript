import * as restate from "./public_api";
import {
  GreetRequest,
  GreetResponse,
  Greeter,
  GreeterClientImpl,
  protoMetadata,
} from "./generated/proto/example";

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

    // rpc
    const client = new GreeterClientImpl(ctx);
    const greeting = await client.greet(request);

    // background call 
    await ctx.inBackground(() => client.greet(request))

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
