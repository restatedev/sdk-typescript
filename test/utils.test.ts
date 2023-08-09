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

import { describe, expect } from "@jest/globals";
import {
  jsonDeserialize,
  jsonSerialize,
  printMessageAsJson,
} from "../src/utils/utils";

describe("JSON de-/serialization", () => {
  it("should be able to handle bigint", () => {
    const myType = {
      a: "Hello!",
      b: 42n,
    };

    const json = jsonSerialize(myType);
    const obj = jsonDeserialize(json);

    expect(obj).toStrictEqual(myType);
  });
});

describe("JSON printing", () => {
  it("should be able to handle bigInt", () => {
    const myType = {
      a: "Hello!",
      b: 42n,
    };

    printMessageAsJson(myType);
  });
});
