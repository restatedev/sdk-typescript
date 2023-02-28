import * as restate from "./public_api";
import {
  GreetRequest,
  GreetResponse,
  Greeter,
  GreeterClientImpl,
  protoMetadata,
} from "./generated/proto/example";

class GreeterService implements Greeter {
  async greet(request: GreetRequest): Promise<GreetResponse> {
    return GreetResponse.create({ greeting: `Hello ${request.name}` });
  }

  async multiWord(request: GreetRequest): Promise<GreetResponse> {
    const ctx = restate.useContext(this);

    const client = new GreeterClientImpl(ctx);
    const greeting = await client.greet(request);

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
