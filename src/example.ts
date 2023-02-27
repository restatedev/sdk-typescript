/**
 * This file is here for the ease of early development and prototyping.
 */

import { RestateContext } from "./core";
import { Restate } from "./restate";

let restate = new Restate();

restate.bind({
  method: "/dev.restate.Greeter/greet",
  fn: async function (context: RestateContext, message: any) {
      console.log(`I don't do a lot just yet.`);
  }
 });


 console.log("Hello world!");