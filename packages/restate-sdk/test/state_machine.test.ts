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

import { describe, expect } from "@jest/globals";
import type { TestGreeter } from "./testdriver";
import { TestDriver, TestResponse } from "./testdriver";
import {
  END_MESSAGE,
  greetRequest,
  greetResponse,
  inputMessage,
  outputMessage,
  startMessage,
} from "./protoutils";

class Greeter implements TestGreeter {
  async greet(): Promise<TestResponse> {
    return TestResponse.create({ greeting: `Hello` });
  }
}

describe("Greeter", () => {
  it("sends message to runtime", async () => {
    const result = await new TestDriver(new Greeter(), [
      startMessage({ knownEntries: 1, key: "Pete" }),
      inputMessage(greetRequest("Pete")),
    ]).run();

    expect(result).toStrictEqual([
      outputMessage(greetResponse("Hello")),
      END_MESSAGE,
    ]);
  });

  it("handles replay of output message", async () => {
    const result = await new TestDriver(new Greeter(), [
      startMessage({ knownEntries: 2, key: "Pete" }),
      inputMessage(greetRequest("Pete")),
      outputMessage(greetResponse("Hello")),
    ]).run();

    expect(result).toStrictEqual([END_MESSAGE]);
  });
});
