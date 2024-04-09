/*
 * Copyright (c) 2023-2023 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

/* eslint-disable no-console */

import * as restate from "../src/public_api";
import type { CounterObject, GreeterService } from "./example";

const Greeter: GreeterService = { name: "greeter" };
const Counter: CounterObject = { name: "counter" };

const ingress = restate.ingress.connect({ url: "http://localhost:8080" });

const simpleCall = async (name: string) => {
  const greeter = ingress.serviceClient(Greeter);
  const greeting = await greeter.greet(name);

  console.log(greeting);
};

const objectCall = async (name: string) => {
  const counter = ingress.objectClient(Counter, name);
  const count = await counter.count();

  console.log(`The count for ${name} is ${count}`);
};

const idempotentCall = async (name: string, idempotencyKey: string) => {
  const greeter = ingress.serviceClient(Greeter);

  // send the request with the idempotent key, and ask restate
  // to remember that key for 3 seconds.
  const greeting = await greeter.greet(
    name,
    restate.ingress.Opts.from({ idempotencyKey })
  );

  console.log(greeting);
};

const customHeadersCall = async (name: string) => {
  const greeter = ingress.serviceClient(Greeter);

  const greeting = await greeter.greet(
    name,
    restate.ingress.Opts.from({ headers: { "x-bob": "1234" } })
  );

  console.log(greeting);
};

const globalCustomHeaders = async (name: string) => {
  const ingress = restate.ingress.connect({
    url: "http://localhost:8080",
    headers: { Authorization: "Bearer mytoken123" },
  });

  const greeting = await ingress.serviceClient(Greeter).greet(name);

  console.log(greeting);
};

const delayedCall = async (name: string) => {
  const ingress = restate.ingress.connect({
    url: "http://localhost:8080",
  });

  const greeting = await ingress
    .serviceSendClient(Greeter)
    .greet(name, restate.ingress.SendOpts.from({ delay: 1000 }));

  console.log(greeting);
};

// Before running this example, make sure
// to run and register `greeter` and `counter` services.
//
// to run them, run:
//
// 1. npm run example
// 2. make sure that restate is running
// 3. restate deployment add localhost:9080

Promise.resolve()
  .then(() => simpleCall("bob"))
  .then(() => objectCall("bob"))
  .then(() => objectCall("mop"))
  .then(() => idempotentCall("joe", "idemp-1"))
  .then(() => idempotentCall("joe", "idemp-1"))
  .then(() => customHeadersCall("bob"))
  .then(() => globalCustomHeaders("bob"))
  .then(() => delayedCall("bob"))
  .catch((e) => console.error(e));
