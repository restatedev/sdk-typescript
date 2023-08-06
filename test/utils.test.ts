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
