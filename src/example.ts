import { GreetRequest, GreetResponse } from "./generated/example_pb";
import { Restate, RestateContext } from "./public_api";

const restate = new Restate();

// this is not an gRPC service just yet, but it is here
// just as an example.

restate.bind({
  method: "/dev.restate.Greeter/greet",
  fn: async (context: RestateContext, message: GreetRequest) => {
    console.log(`I don't do a lot just yet. ${message.name}`);

    return new GreetResponse({ greeting: "hello" });
  },
});

restate.listen(8000);

console.log("Hello world!");
