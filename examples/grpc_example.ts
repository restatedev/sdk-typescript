/*
 * Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

/*
 * A simple example program using the Restate gRPC-based API.
 *
 * This example primarily exists to make it simple to test the code against
 * a running Restate instance.
 */

import * as restate from "../src/public_api";
import {
  TestRequest,
  TestResponse,
  TestGreeter,
  protoMetadata,
} from "../src/generated/proto/test";

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
