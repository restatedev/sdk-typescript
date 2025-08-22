import { describe, expect, it } from "vitest";
import * as z3 from "zod/v3";
import * as z4 from "zod/v4";
import { serde } from "../src/serde_api.js";

/* eslint-disable @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access */

const typeTestData = {
  name: "Type Test",
  validData: {
    id: 1,
    name: "test",
    isActive: true,
  },
  invalidData: {
    id: -1, // not positive
    name: "a", // less than 3 characters
    isActive: "not a boolean",
  },
};

const z3TypeTestData = {
  ...typeTestData,
  name: `v3 ${typeTestData.name}`,
  zodSchema: z3.object({
    id: z3.number().int().positive(),
    name: z3
      .string()
      .min(3, { message: "Name must be at least 3 characters long" }),
    isActive: z3.boolean(),
  }),
  jsonSchema: undefined,
};

const z4TypeTestData = {
  ...typeTestData,
  name: `v4 ${typeTestData.name}`,
  zodSchema: z4.object({
    id: z4.number().int().positive(),
    name: z4
      .string()
      .min(3, { message: "Name must be at least 3 characters long" }),
    isActive: z4.boolean(),
  }),
  jsonSchema: undefined,
};
z4TypeTestData.jsonSchema = z4.toJSONSchema(z4TypeTestData.zodSchema);

const stringTestData = {
  name: "stringTest",
  validData: "just a string",
  invalidData: -1,
};

const z3StringTestData = {
  ...stringTestData,
  name: `v3 ${stringTestData.name}`,
  zodSchema: z3.string(),
  jsonSchema: undefined,
};

const z4StringTestData = {
  ...stringTestData,
  name: `v4 ${stringTestData.name}`,
  zodSchema: z4.string(),
  jsonSchema: undefined,
};
z4StringTestData.jsonSchema = z4.toJSONSchema(z4StringTestData.zodSchema);

describe("serde_api", () => {
  describe.each([
    z3TypeTestData,
    z4TypeTestData,
    z3StringTestData,
    z4StringTestData,
  ])("zod $name", ({ zodSchema, jsonSchema, validData, invalidData }) => {
    const validDataSerialized = new TextEncoder().encode(
      JSON.stringify(validData)
    );
    const invalidDataSerialized = new TextEncoder().encode(
      JSON.stringify(invalidData)
    );
    const srd = serde.zod(zodSchema);

    describe("constructor", () => {
      it("converts a valid schema to json", () => {
        expect(srd.jsonSchema).not.to.be.null;
        expect(srd.jsonSchema).to.deep.equal(jsonSchema);
      });
    });
    describe("serialize", () => {
      it("serializes a valid object", () => {
        expect(srd.serialize(validData)).to.deep.equal(validDataSerialized);
      });
      it("gives an empty response for undefined", () => {
        expect(srd.serialize(undefined)).to.be.empty;
      });
    });
    describe("deserialize", () => {
      it("deserializes a valid object", () => {
        expect(
          srd.deserialize(new TextEncoder().encode(JSON.stringify(validData)))
        ).to.deep.equal(validData);
      });
      it("throws an error on an invalid object", () => {
        expect(() => srd.deserialize(invalidDataSerialized)).throws();
      });
    });
  });
});
