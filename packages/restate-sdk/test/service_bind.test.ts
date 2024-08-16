/*
 * Copyright (c) 2023-2024 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

import type { TestGreeter, TestRequest } from "./testdriver.js";
import { TestDriver, TestResponse, testService } from "./testdriver.js";
import * as restate from "../src/public_api.js";
import {
  END_MESSAGE,
  greetRequest,
  inputMessage,
  outputMessage,
  startMessage,
} from "./protoutils.js";
import { describe, expect, it } from "vitest";

const greeter: TestGreeter = {
  // eslint-disable-next-line @typescript-eslint/require-await
  greet: async (
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ctx: restate.ObjectContext,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    req: TestRequest
  ): Promise<TestResponse> => {
    return TestResponse.create({ greeting: `Hello` });
  },
};

const greeterFoo = {
  /* eslint-disable @typescript-eslint/no-unused-vars */
  greet(ctx: restate.ObjectContext, req: TestRequest): Promise<TestResponse> {
    return this.foo(ctx, req);
  },

  // eslint-disable-next-line @typescript-eslint/require-await
  async foo(
    ctx: restate.ObjectContext,
    req: TestRequest
  ): Promise<TestResponse> {
    return TestResponse.create({ greeting: `Hello` });
  },
};

describe("BindService", () => {
  it("should bind object literals", async () => {
    await new TestDriver(greeter, [
      startMessage({ knownEntries: 1 }),
      inputMessage(greetRequest("Pete")),
    ]).run();
  });

  it("should bind and preserve `this`", async () => {
    await new TestDriver(greeterFoo, [
      startMessage({ knownEntries: 1 }),
      inputMessage(greetRequest("Pete")),
    ]).run();
  });
});

const acceptBytes = restate.service({
  name: "acceptBytes",
  handlers: {
    greeter: restate.handlers.handler(
      {
        accept: "application/octet-stream",
        contentType: "application/json",
      },
      // eslint-disable-next-line @typescript-eslint/require-await
      async (_ctx: restate.Context, audio: Uint8Array) => {
        return { length: audio.length };
      }
    ),
  },
});

describe("AcceptBytes", () => {
  it("should accept bytes", async () => {
    const result = await testService(acceptBytes).run({
      input: [startMessage(), inputMessage(new Uint8Array([0, 1, 2, 3, 4]))],
    });

    expect(result).toStrictEqual([
      outputMessage(new TextEncoder().encode(JSON.stringify({ length: 5 }))),
      END_MESSAGE,
    ]);
  });
});
