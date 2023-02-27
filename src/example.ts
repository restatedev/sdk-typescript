import { Restate, RestateContext } from "./public_api";

const restate = new Restate();

// this is not an gRPC service just yet, but it is here
// just as an example.

restate.bind({
  method: "/dev.restate.Greeter/greet",
  fn: async function (context: RestateContext, message: any) {
    console.log(`I don't do a lot just yet.`);
  },
});

restate.listen(8000);

console.log("Hello world!");
