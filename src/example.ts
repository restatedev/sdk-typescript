import { Restate } from "./public_api";
import {
  GreetRequest,
  GreetResponse,
  Greeter,
  protoMetadata,
} from "./generated/proto/example";

const restate = new Restate();

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

restate.bind({
  descriptor: protoMetadata,
  service: "Greeter",
  instance: new GreeterService(),
});

// fake some
async function round(
  service: string,
  method: string,
  arg: GreetRequest
): Promise<GreetResponse> {
  const inputBytes = GreetRequest.encode(arg).finish();
  const s = restate.services[service];
  const input = s.methods[method].inputDecoder(inputBytes);

  console.log(s.methods[method]);
  const output = await s.methods[method].localFn(input);
  const outputBytes = s.methods[method].outputEncoder(output);
  return GreetResponse.decode(outputBytes);
}

const req = GreetRequest.create({ name: "bob" });
round("Greeter", "MultiWord", req).then((res) => console.log(res));

restate.listen(8000);
