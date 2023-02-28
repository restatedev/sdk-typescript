import { describe, expect } from "@jest/globals";
import * as restate from "../src/public_api";
import {
  GreetRequest,
  GreetResponse,
  Greeter,
  protoMetadata,
} from "../src/generated/proto/example";

class GreeterService implements Greeter {
  async greet(request: GreetRequest): Promise<GreetResponse> {
    return GreetResponse.create({ greeting: `Hello ${request.name}` });
  }

  async multiWord(request: GreetRequest): Promise<GreetResponse> {
    return GreetResponse.create({
      greeting: `YAGM (yet another greeting method) ${request.name}!`,
    });
  }
}

describe("BindingTest", () => {
  it("Should demonstrate how to invoke a service method", async () => {
    const r = restate.createServer().bindService({
      descriptor: protoMetadata,
      service: "Greeter",
      instance: new GreeterService(),
    });

    const arg = GreetRequest.create({ name: "bob" });
    const inBytes = GreetRequest.encode(arg).finish();
    const outBytes = await r.fakeInvoke("dev.restate.Greeter/Greet", inBytes);
    const out = GreetResponse.decode(outBytes);

    expect(out.greeting).toStrictEqual("Hello bob");
  });
});
